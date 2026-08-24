"use strict";

const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const os = require("os");

const PUBLIC_FETCH_MAX_BYTES = 4 * 1024 * 1024;
const PUBLIC_FETCH_MAX_URL_LENGTH = 16 * 1024;
const PUBLIC_FETCH_TIMEOUT_MS = 12000;
const PUBLIC_FETCH_QUEUE_TIMEOUT_MS = 30000;
const PUBLIC_FETCH_MAX_REDIRECTS = 4;
const PUBLIC_FETCH_MAX_CONCURRENT = 20;

function normalizedIp(value) {
  const address = String(value || "").toLowerCase().split("%", 1)[0];
  return address.startsWith("::ffff:") && net.isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1", "[::ffff:127.0.0.1]"]
    .includes(String(hostname || "").toLowerCase().replace(/\.$/, ""));
}

function localNetworkFacts() {
  const localHostnames = new Set([os.hostname(), `${os.hostname()}.local`].map(value => value.toLowerCase().replace(/\.$/, "")));
  const localInterfaceAddresses = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family === 4 || entry.family === "IPv4" ? "ipv4" : entry.family === 6 || entry.family === "IPv6" ? "ipv6" : null;
      const address = String(entry.address || "").split("%", 1)[0];
      if (!family || !address) continue;
      localInterfaceAddresses.add(address.toLowerCase());
    }
  }
  return { localHostnames, localInterfaceAddresses };
}

function blockedAddresses() {
  const blocked = new net.BlockList();
  for (const [address, prefix] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ]) blocked.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of [
    ["::", 128], ["::1", 128], ["100::", 64], ["2001:2::", 48], ["2001:db8::", 32],
    ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ]) blocked.addSubnet(address, prefix, "ipv6");
  return blocked;
}

function createPublicFetchService(options = {}) {
  const maxBytes = Number(options.maxBytes || PUBLIC_FETCH_MAX_BYTES);
  const maxUrlLength = Number(options.maxUrlLength || PUBLIC_FETCH_MAX_URL_LENGTH);
  const maxRedirects = Number(options.maxRedirects || PUBLIC_FETCH_MAX_REDIRECTS);
  const maxConcurrent = Number(options.maxConcurrent || PUBLIC_FETCH_MAX_CONCURRENT);
  const queueTimeoutMs = Number(options.queueTimeoutMs || PUBLIC_FETCH_QUEUE_TIMEOUT_MS);
  const dnsLookup = options.dnsLookup || dns.lookup;
  const makeRequest = options.makeRequest || ((url, requestOptions, callback) => (url.protocol === "http:" ? http : https).request(url, requestOptions, callback));
  const { localHostnames, localInterfaceAddresses } = options.networkFacts || localNetworkFacts();
  const publicFetchBlockedAddresses = blockedAddresses();
  const publicFetchQueue = [];
  let activePublicFetches = 0;

  function publicFetchFailure(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function publicFetchAbortError() {
    const error = new Error("The public data request was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function waitForPublicFetchSlot(signal) {
    if (signal?.aborted) return Promise.reject(publicFetchAbortError());
    if (activePublicFetches < maxConcurrent) {
      activePublicFetches++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, done:false, timer:null, abort:null };
      const fail = (error) => {
        if (entry.done) return;
        entry.done = true;
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", entry.abort);
        const index = publicFetchQueue.indexOf(entry);
        if (index >= 0) publicFetchQueue.splice(index, 1);
        reject(error);
      };
      entry.abort = () => fail(publicFetchAbortError());
      entry.timer = setTimeout(() => fail(publicFetchFailure("The public data request waited in the queue for 30 seconds.", 504)), queueTimeoutMs);
      signal?.addEventListener("abort", entry.abort, { once:true });
      publicFetchQueue.push(entry);
    });
  }

  function releasePublicFetchSlot() {
    activePublicFetches = Math.max(0, activePublicFetches - 1);
    while (publicFetchQueue.length) {
      const entry = publicFetchQueue.shift();
      if (!entry || entry.done) continue;
      entry.done = true;
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.abort);
      if (entry.signal?.aborted) {
        entry.reject(publicFetchAbortError());
        continue;
      }
      activePublicFetches++;
      entry.resolve();
      break;
    }
  }

  function publicFetchAddressAllowed(value) {
    const address = normalizedIp(value), family = net.isIP(address);
    return Boolean(family) && !localInterfaceAddresses.has(address.toLowerCase())
      && !publicFetchBlockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
  }

  async function resolvedPublicFetchTarget(value, { allowHttp = false } = {}) {
    if (typeof value !== "string" || !value || value.length > maxUrlLength) {
      throw publicFetchFailure(allowHttp ? "A public HTTP(S) URL is required." : "A public HTTPS URL is required.");
    }
    let url;
    try { url = new URL(value); } catch { throw publicFetchFailure(allowHttp ? "A valid public HTTP(S) URL is required." : "A valid public HTTPS URL is required."); }
    const allowedProtocols = allowHttp ? ["http:", "https:"] : ["https:"];
    if (!allowedProtocols.includes(url.protocol) || url.username || url.password) {
      throw publicFetchFailure(allowHttp ? "Only public HTTP(S) URLs without embedded credentials are supported." : "Only public HTTPS URLs without embedded credentials are supported.");
    }
    url.hash = "";
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""), literalFamily = net.isIP(hostname);
    if (!hostname || isLoopbackHostname(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local") || localHostnames.has(hostname)) {
      throw publicFetchFailure("Local and private destinations are not available.", 403);
    }
    let addresses;
    if (literalFamily) addresses = [{ address:hostname, family:literalFamily }];
    else {
      try { addresses = await dnsLookup(hostname, { all:true, verbatim:true }); }
      catch { throw publicFetchFailure("The public data host could not be resolved.", 502); }
    }
    if (!addresses.length || addresses.some(({ address }) => !publicFetchAddressAllowed(address))) {
      throw publicFetchFailure("Local and private destinations are not available.", 403);
    }
    const selected = addresses[0];
    return { url, address:normalizedIp(selected.address), family:net.isIP(normalizedIp(selected.address)) };
  }

  function publicFetchContentType(value) {
    return String(value || "").slice(0, 200) || "application/octet-stream";
  }

  async function fetchPublicResponse(value, signal, redirects = 0, options = {}) {
    const allowHttp = options.allowHttp === true;
    const target = await resolvedPublicFetchTarget(value, { allowHttp });
    const response = await new Promise((resolve, reject) => {
      const request = makeRequest(target.url, {
        method:"GET",
        signal,
        headers:{
          "Accept":"*/*",
          "Accept-Language":"zh-CN,zh;q=0.9,en;q=0.7",
          "User-Agent":"Mozilla/5.0 (compatible; PenEcho/0.8; public-data-reader)",
        },
        lookup(_hostname, requestOptions, callback) {
          if (requestOptions && typeof requestOptions === "object" && requestOptions.all) callback(null, [{ address:target.address, family:target.family }]);
          else callback(null, target.address, target.family);
        },
      }, resolve);
      request.once("error", reject);
      request.end();
    });
    const status = Number(response.statusCode) || 502;
    const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      response.resume();
      if (redirects >= maxRedirects) throw publicFetchFailure("The public data request redirected too many times.", 508);
      let next;
      try { next = new URL(location, target.url).href; } catch { throw publicFetchFailure("The public data source returned an invalid redirect.", 502); }
      return fetchPublicResponse(next, signal, redirects + 1, options);
    }
    const noBody = [204, 205, 304].includes(status);
    const contentType = noBody ? "text/plain; charset=utf-8" : publicFetchContentType(response.headers["content-type"]);
    const declaredLength = Number(response.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      response.destroy();
      throw publicFetchFailure("The public data response is too large.", 413);
    }
    const body = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) return response.destroy(publicFetchFailure("The public data response is too large.", 413));
        chunks.push(chunk);
      });
      response.once("end", () => resolve(Buffer.concat(chunks)));
      response.once("error", reject);
    });
    return { status:status >= 200 && status <= 599 ? status : 502, contentType, body, finalUrl:target.url.href };
  }

  async function fetchPublicResource(value, signal, options = {}) {
    let slotAcquired = false;
    try {
      await waitForPublicFetchSlot(signal);
      slotAcquired = true;
      return await fetchPublicResponse(value, signal, 0, options);
    } finally {
      if (slotAcquired) releasePublicFetchSlot();
    }
  }

  return {
    maxBytes,
    maxUrlLength,
    maxRedirects,
    maxConcurrent,
    queueTimeoutMs,
    publicFetchFailure,
    publicFetchAbortError,
    waitForPublicFetchSlot,
    releasePublicFetchSlot,
    resolvedPublicFetchTarget,
    fetchPublicResponse,
    fetchPublicResource,
  };
}

const publicFetchService = createPublicFetchService();

module.exports = {
  PUBLIC_FETCH_MAX_BYTES,
  PUBLIC_FETCH_MAX_URL_LENGTH,
  PUBLIC_FETCH_TIMEOUT_MS,
  PUBLIC_FETCH_QUEUE_TIMEOUT_MS,
  PUBLIC_FETCH_MAX_REDIRECTS,
  PUBLIC_FETCH_MAX_CONCURRENT,
  createPublicFetchService,
  publicFetchFailure:publicFetchService.publicFetchFailure,
  publicFetchAbortError:publicFetchService.publicFetchAbortError,
  waitForPublicFetchSlot:publicFetchService.waitForPublicFetchSlot,
  releasePublicFetchSlot:publicFetchService.releasePublicFetchSlot,
  resolvedPublicFetchTarget:publicFetchService.resolvedPublicFetchTarget,
  fetchPublicResponse:publicFetchService.fetchPublicResponse,
  fetchPublicResource:publicFetchService.fetchPublicResource,
};
