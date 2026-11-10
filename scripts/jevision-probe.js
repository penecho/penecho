#!/usr/bin/env node
"use strict";
// Probe the running local PenEchoLLM gateway with its stored account/trial.
// PENECHO_PROBE_ORIGIN must point to an operator-selected local Canvas server.
const SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABuAQAAAAB+Ovf1AAAB8UlEQVR42u2WP47UMBTGP3stkgKR3GBCR7n9SkzERdgTIHECLDElxZ6As0QIaZu9ApoELpBdgcggx48icfI8JBlXVE4xefH84vfne7YjCGGXRAQjGMEIRvBXHgg+/HTWKd92bZ2Rbs94PI5GzwZp6WrHeyd2bmjZtRjv6uZCedxR0VcXwMfx/uxSwdVkldvgZ2eYajvrzBlmz7LuCzzq6cUGfU6THuY8Rs38mus/t2tat/NArjt0ehGUQOPVpnyaHzSfseW5p9UPPb/XVRwsUAEkhBj4b3hYadwaau4sdfud7pb0IKKMMiILQBCRfZEYXE1t9MHrHgJg0zf54axZ/UYhSuyOqZLujE7cQz0Ng4gSw0HsFzqYSAHQpmAuNP9uaTM/rZLXYajxSRT/lMec+MjeGQVbEwOoaBEEgKMHPm81U8ZV5+X0M4HXDVvzfTeq/BYAag+0kouVD8mk2l88EoCsmDLm1dAwCVVehysAVgG4+j26LO9XJWwSpkXtyfSReFMQb4NGbGykfN/8ItgCYv/IcwUP6LjWXoxPLCqbEYsYcwtLAJbJb3N8Wo+RuTYFvBjV2ibVlXjN1u77eW8loNkFnjMi9ECqQ0EZCn4NAQUBaRc2Y58Guj7koTEWgaAsQ0AFZO9Cs47fPRGMYAT/N/gXlHZg0lv57RUAAAAASUVORK5CYII=";

async function main() {
  const origin=new URL(process.env.PENECHO_PROBE_ORIGIN || "http://127.0.0.1:3921");
  if(!["127.0.0.1","localhost","[::1]"].includes(origin.hostname))throw new Error("Use a loopback Canvas origin.");
  const response=await fetch(new URL("/api/suggest",origin),{method:"POST",headers:{"content-type":"application/json",origin:origin.origin},body:JSON.stringify({version:1,mode:"ink",image:SAMPLE_IMAGE,context:{shapesFit:false}}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  console.log(JSON.stringify({status:response.status,model:result.model,answers:result.answers,access:result.access,error:result.error}));
  if(!response.ok)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
