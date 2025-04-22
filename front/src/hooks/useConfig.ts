import { useEffect, useState } from "react";
import { fetchConfig } from "../services/config";
import { setfaucetContractName } from "../types/faucet";

export function useConfig() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await fetchConfig();
        setfaucetContractName(config.contract_name);
        setIsLoading(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load configuration",
        );
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  return { isLoading, error };
}
