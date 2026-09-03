const RETRY_DELAYS_MS = [150, 450];

export async function resilientFetch(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.status < 500 || attempt === RETRY_DELAYS_MS.length) return response;
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_DELAYS_MS.length) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }

  throw lastError instanceof Error ? lastError : new Error("Databázové připojení selhalo.");
}
