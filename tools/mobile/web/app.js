"use strict";

const form = document.querySelector("#connectForm");
const input = document.querySelector("#serverUrl");
const error = document.querySelector("#error");
const saved = localStorage.getItem("penecho.mobile.serverUrl");

if (saved) input.value = saved;

function showError(message) {
  error.hidden = false;
  error.textContent = message;
}

form.addEventListener("submit", event => {
  event.preventDefault();
  error.hidden = true;
  let target;
  try {
    target = new URL(input.value.trim());
  } catch {
    showError("Enter a complete server address, including http:// or https://.");
    return;
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
    showError("Use an http:// or https:// server address without credentials or query parameters.");
    return;
  }
  target.pathname = "/";
  target.search = "";
  localStorage.setItem("penecho.mobile.serverUrl", target.href);
  window.location.href = target.href;
});
