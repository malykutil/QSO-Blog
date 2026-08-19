import "server-only";

type BackendRequestOptions = {
  method?: "GET" | "PUT";
  body?: unknown;
};

function getBackendConfig() {
  const rawUrl = process.env.TRADING_ASSISTANT_URL?.trim();
  const token = process.env.TRADING_ASSISTANT_API_TOKEN?.trim();

  if (!rawUrl || !token || token.length < 32) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const localDevelopment = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localDevelopment)) {
    return null;
  }

  return { baseUrl: url.toString().replace(/\/$/, ""), token };
}

export async function tradingBackendRequest(path: string, options: BackendRequestOptions = {}) {
  const config = getBackendConfig();
  if (!config) {
    throw new Error("TRADING_BACKEND_NOT_CONFIGURED");
  }

  return fetch(`${config.baseUrl}${path}`, {
    method: options.method ?? "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(12_000),
  });
}
