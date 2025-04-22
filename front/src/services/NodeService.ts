import { NodeApiHttpClient } from "hyle";

class NodeService {
  client: NodeApiHttpClient;

  constructor() {
    this.client = new NodeApiHttpClient(import.meta.env.VITE_NODE_BASE_URL);
  }
}

export const nodeService = new NodeService();
