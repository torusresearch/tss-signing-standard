import { TORUS_SAPPHIRE_NETWORK_TYPE } from "@toruslabs/constants";
import { fetchLocalConfig } from "@toruslabs/fnd-base";

// NOTE: This URL should not be constant and should be a URL to one of the servers of the set, 
// randomized to spread the load, biased towards servers which are not active participants in the set,
// the wasm file is identical for all servers.
// devnet set: ["https://sapphire-dev-2-1.authnetwork.dev/tss/v1/clientWasm",
//              "https://sapphire-dev-2-2.authnetwork.dev/tss/v1/clientWasm",
//              "https://sapphire-dev-2-3.authnetwork.dev/tss/v1/clientWasm",
//              "https://sapphire-dev-2-4.authnetwork.dev/tss/v1/clientWasm",
//              "https://sapphire-dev-2-5.authnetwork.dev/tss/v1/clientWasm"]
export const tssImportUrl =  "https://sapphire-dev-2-5.authnetwork.dev/tss/v1/clientWasm";

// This function is supposed to be imported and used from TSSClient, however it needs to be updated slightly there
// since it only accounts for mainnet on auth.network DNS.
export function generateEndpoints(parties: number, clientIndex: number, network: TORUS_SAPPHIRE_NETWORK_TYPE, nodeIndexes: number[] = []) {
    const networkConfig = fetchLocalConfig(network, "secp256k1");
    const endpoints = [];
    const tssWSEndpoints = [];
    const partyIndexes = [];
  
    for (let i = 0; i < parties; i++) {
      partyIndexes.push(i);
  
      if (i === clientIndex) {
        endpoints.push(null);
        tssWSEndpoints.push(null);
      } else {
        endpoints.push(networkConfig.torusNodeTSSEndpoints[nodeIndexes[i] ?  nodeIndexes[i] - 1 : i]);
        let wsEndpoint = networkConfig.torusNodeEndpoints[nodeIndexes[i] ? nodeIndexes[i] - 1 : i]
        if (wsEndpoint) {
          const urlObject = new URL(wsEndpoint);
          wsEndpoint = urlObject.origin;
        }
        tssWSEndpoints.push(wsEndpoint);
      }
    }
  
    return {
      endpoints: endpoints,
      tssWSEndpoints: tssWSEndpoints,
      partyIndexes: partyIndexes
    };
  }