import EC from "elliptic";
import TorusUtils from "@toruslabs/torus.js";
import KJUR from "jsrsasign";
import { fetchLocalConfig } from "@toruslabs/fnd-base";

export function getEcCrypto(): any {
  // eslint-disable-next-line new-cap
  return new EC.ec("secp256k1");
}

export function ecPoint(p: { x: string, y: string }): any {
  const ec = getEcCrypto();
  return ec.keyFromPublic({ x: p.x.padStart(64, "0"), y: p.y.padStart(64, "0") }).getPublic();
}

const jwtPrivateKey = `-----BEGIN PRIVATE KEY-----\nMEECAQAwEwYHKoZIzj0CAQYIKoZIzj0DAQcEJzAlAgEBBCCD7oLrcKae+jVZPGx52Cb/lKhdKxpXjl9eGNa1MlY57A==\n-----END PRIVATE KEY-----`;
export const generateIdToken = (email: string) => {
  const alg = "ES256";
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "torus-key-test",
    aud: "torus-key-test",
    name: email,
    email,
    scope: "email",
    iat,
    eat: iat + 120,
  };

  const options = {
    expiresIn: 120,
    algorithm: alg,
  };

  const header = { alg, typ: "JWT" };

  const token = KJUR.jws.JWS.sign(alg, header, payload, jwtPrivateKey, options);

  return token;
};


export async function fetchPostboxKeyAndSigs(opts, network) {
  const networkDetails = fetchLocalConfig(network, "secp256k1");
  console.log("networkDetails", networkDetails);
  const torus = new TorusUtils({
    clientId: "torus-default",
    network,
    enableOneKey: true,
  });

  const { verifierName, verifierId } = opts;
  const token = generateIdToken(verifierId);

  const torusKeyData = await torus.retrieveShares(networkDetails.torusNodeSSSEndpoints, networkDetails.torusIndexes, verifierName, { verifier_id: verifierId }, token);
  const {  nodesData, sessionData } = torusKeyData;
  const signatures = [];
  sessionData.sessionTokenData.filter((session) => {
    if (session) {
      signatures.push(
        JSON.stringify({
          data: session.token,
          sig: session.signature,
        })
      );
    }
    return null;
  });

  const postboxKey = TorusUtils.getPostboxKey(torusKeyData);
  return {
    signatures,
    postboxkey: postboxKey,
    nodeIndexes: nodesData.nodeIndexes.slice(0, 3)
  };
}