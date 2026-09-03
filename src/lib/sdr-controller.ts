import "server-only";

import { request as httpsRequest } from "node:https";

type ControllerFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

type DnsJsonAnswer = { type?: number; data?: string };
type DnsJsonResponse = { Answer?: DnsJsonAnswer[] };

const DNS_CACHE_MS = 5 * 60 * 1000;
let dnsCache: { hostname: string; addresses: string[]; expiresAt: number } | null = null;

function isIpv4(value: string) {
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const number = Number(octet);
    return number >= 0 && number <= 255;
  });
}

async function resolvePublicIpv4(hostname: string) {
  if (dnsCache?.hostname === hostname && dnsCache.expiresAt > Date.now()) return dnsCache.addresses;

  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    {
      cache: "no-store",
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Veřejné DNS vrátilo HTTP ${response.status}.`);
  const payload = await response.json() as DnsJsonResponse;
  const addresses = (payload.Answer ?? [])
    .filter((answer) => answer.type === 1 && typeof answer.data === "string" && isIpv4(answer.data))
    .map((answer) => answer.data as string);
  if (!addresses.length) throw new Error(`Veřejné DNS nenalezlo A záznam pro ${hostname}.`);

  dnsCache = { hostname, addresses, expiresAt: Date.now() + DNS_CACHE_MS };
  return addresses;
}

function requestThroughAddress(url: URL, address: string, options: ControllerFetchOptions) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest({
      host: address,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? "GET",
      servername: url.hostname,
      headers: { Host: url.host, ...(options.headers ?? {}) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode ?? 502,
        headers: response.headers as Record<string, string>,
      })));
    });
    request.setTimeout(options.timeoutMs ?? 8_000, () => request.destroy(new Error("Vypršel čas spojení s RPi.")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

export async function fetchSdrController(target: string, options: ControllerFetchOptions = {}) {
  try {
    return await fetch(target, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (directError) {
    const url = new URL(target);
    if (url.protocol !== "https:") throw directError;
    const addresses = await resolvePublicIpv4(url.hostname);
    let lastError: unknown = directError;
    for (const address of addresses) {
      try {
        return await requestThroughAddress(url, address, options);
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
    throw lastError;
  }
}
