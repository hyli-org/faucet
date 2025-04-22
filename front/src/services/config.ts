interface Config {
  contract_name: string;
}

export async function fetchConfig(): Promise<Config> {
  const response = await fetch(
    `${import.meta.env.VITE_SERVER_BASE_URL}/api/config`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch config");
  }
  return response.json();
}
