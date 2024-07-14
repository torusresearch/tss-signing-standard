// tss server tests
import { Client, DELIMITERS, getDKLSCoeff, getTSSPubKey, setupSockets } from "@toruslabs/tss-client";
import * as tss from "@toruslabs/tss-lib";
import BN from "bn.js";
import { generatePrivate } from "eccrypto";
import keccak256 from "keccak256";
import TorusServiceProvider from "@tkey-mpc/service-provider-torus";
import { MockStorageLayer } from "@tkey-mpc/storage-layer-torus";
import ThresholdKey from "@tkey-mpc/default";
import { fetchPostboxKeyAndSigs, getEcCrypto } from "./torushelpers";
import { getPubKeyPoint } from "@tkey-mpc/common-types";
import { fetchLocalConfig } from "@toruslabs/fnd-base";
import { TORUS_NETWORK_TYPE } from "@toruslabs/constants/dist/types/interfaces";
import { generateEndpoints, tssImportUrl } from "./tssHelpers";
import { sapphire_network, verifierId, verifier, deviceTSSShare, deviceTSSIndex, factorKey, parties, serviceProviderPostboxKey} from "./applicationStore";

const ec = getEcCrypto();

// This function isn't really necessary except to make the unicode characters pretty in the console log.
const log = (...args: unknown[]) => {
    let msg = "";
    args.forEach((arg) => {
      msg += JSON.stringify(arg);
      msg += " ";
    });
    console.log(msg);
};
  
const hexToDecimal = (x) => ec.keyFromPrivate(x, "hex").getPrivate().toString(10);

const runMPCSigning = async () => {
  const network: TORUS_NETWORK_TYPE = sapphire_network;
  const networkConfig = fetchLocalConfig(network, "secp256k1");
  if (!networkConfig) {
    throw new Error(`Invalid network: ${network}`);
  }

  // First we initialize the service provider and storage layer
  const torusSp = new TorusServiceProvider({
    postboxKey: serviceProviderPostboxKey,
    useTSS: true,
    nodeEndpoints: networkConfig.torusNodeEndpoints,
    customAuthArgs: {
      network,
      web3AuthClientId: "YOUR_CLIENT_ID",
      baseUrl: "http://localhost:3000",
    },
  });
  torusSp.verifierName = verifier;
  torusSp.verifierId = verifierId;
  const torusSL =  new MockStorageLayer();
  

  // Second we initialize and reconstruct the Threshold Key, using stored values of factorKey, deviceTssShare, deviceTssIndex
  const tb = new ThresholdKey({ serviceProvider: torusSp, storageLayer: torusSL, manualSync: true });
  
  const factorPub = getPubKeyPoint(factorKey);
  await tb.initialize({ useTSS: true, factorPub, deviceTSSShare, deviceTSSIndex }).catch((err)=>{
    throw new Error(`${err} tkey_error`);
  });

  // If there are additional shares that need to be inserted into the Threshold Key, this will then be done here.

  // This is needed if manual_sync === true, otherwise it has no effect
  await tb.syncLocalMetadataTransitions().catch((err)=>{
    throw new Error(`meta-data error:${err}`);
  });

  // Thirdly reconstruct the key
  tb.reconstructKey();

  // Now we can proceed to do TSS Signing

  // a) Calculate the client index
  // NOTE: Client is always last
  const clientIndex = parties - 1;

  // b) Hash the message to be signed
  const msg = "hello world";
  const msgHash = keccak256(msg);

  // c) Calculate a random session nonce, retrieve the tssNonce by tssTag, construct the full session
  const randomSessionNonce = keccak256(generatePrivate().toString("hex") + Date.now());
  const vid = `${verifier}${DELIMITERS.Delimiter1}${torusSp.verifierId}`;
  const tssNonce = tb.metadata.tssNonces[tb.tssTag];
  const session = `${vid}${DELIMITERS.Delimiter2}default${DELIMITERS.Delimiter3}${tssNonce}${
    DELIMITERS.Delimiter4
    }${randomSessionNonce.toString("hex")}`;

  // d) Retrieve nodeIndexes, signatures, generate the endpoints and setup the sockets
  const { signatures, nodeIndexes } = await fetchPostboxKeyAndSigs({ verifierName: verifier, verifierId: torusSp.verifierId }, network).catch((err) => {
    throw new Error(`${err} sss_error`);
  });
  const { endpoints, tssWSEndpoints, partyIndexes } = generateEndpoints(parties, clientIndex, network, nodeIndexes);

  const [sockets] = await Promise.all([
    setupSockets(tssWSEndpoints, session.split(DELIMITERS.Delimiter4)[1]
    ),
    tss.default(tssImportUrl),
  ]);

  // e) Retrieve the dkgTssPublicKey from the service provider, retrieve the tssShare and tssIndex from the threshold key using the factorKey,
  // then derive the finalTssPubKey using these that will be used for signing
  const { pubKey: pubKeyDetails } = await tb.serviceProvider.getTSSPubKey(tb.tssTag, tssNonce);
  const dkgTssPubKey = { x: pubKeyDetails.x.toString("hex"), y: pubKeyDetails.y.toString("hex") };
  const { tssShare: userShare, tssIndex: userTSSIndex } = await tb.getTSSShare(factorKey);
  const userSharePub = ec.curve.g.mul(userShare);
  const userSharePubKey = { x: userSharePub.getX().toString("hex"), y: userSharePub.getY().toString("hex") };
  const tssPubKey = getTSSPubKey(dkgTssPubKey, userSharePubKey, userTSSIndex);
  const finalTssPubKey = Buffer.from(`${tssPubKey.getX().toString(16, 64)}${tssPubKey.getY().toString(16,64)}`, "hex").toString("base64");

  // f) Derive the coefficients for the share the client will use and then denormalise the share
  const participatingServerDKGIndexes = nodeIndexes;
  const dklsCoeff = getDKLSCoeff(true, participatingServerDKGIndexes, userTSSIndex);
  const denormalisedShare = dklsCoeff.mul(userShare).umod(ec.curve.n);
  const share = Buffer.from(denormalisedShare.toString(16, 64), "hex").toString("base64");

  // g) Derive the coefficients that the servers will use for their own retrieved shares using the nodeIndexes,
  // serverIndex and the userTssIndex 
  const serverCoeffs = {};
  for (let i = 0; i < participatingServerDKGIndexes.length; i++) {
    const serverIndex = participatingServerDKGIndexes[i];
    serverCoeffs[serverIndex] = getDKLSCoeff(false, participatingServerDKGIndexes, userTSSIndex, serverIndex).toString("hex");
  }

  // h) Initialize the client using all the necessary variables.
  const client = new Client(session, clientIndex, partyIndexes, endpoints, sockets, share, finalTssPubKey, true, tssImportUrl);
  client.log = (...args: unknown[]) => {
    log(...args)
  };

  // i) Perform setup and precompute via the precompute route, all parties including the client will follow these steps.
  // NOTE:
  // Preferably upgrade the client to minimum version of 2.3.3, since infinite promises are possible in older versions.
  // If signing fails and the servers logs show failure on setting up the signer with message ~puid_seed, the share being given to the client is wrong.
  // If signing fails and the servers logs show failure on "Second Consistency Check Failed", serverCoeffs or finalTssPubKey is wrong (which also means that either the userTssIndex or tssTag is wrong).
  // Anything else is likely a disconnect (which require implementation of socket state recovery to be able to reconnect) and the clients' only option would be to try again with a new session.
  // Remember that the client sends the configuration to the servers on which they will operate, it is CRITICAL to get this correct.
  client.precompute(tss, { signatures, server_coeffs: serverCoeffs });

  // j) Wait till client reports it is ready
  await client.ready();

  // k) Collect all signature fragments from the servers and combine it with the one of the client to produce the final signature
  const signature = await client.sign(tss, msgHash.toString("base64"), true, msg, "keccak256", { signatures });

  // l) Checks to ensure the signature is valid (the client should already do this internally, but sanity check is good).
  const pubk = ec.recoverPubKey(hexToDecimal(msgHash), signature, signature.recoveryParam, "hex");
  const passed = ec.verify(msgHash, signature, pubk);

  // m) Tell the client to cleanup for this session, this will also inform the servers to cleanup for this session
  // This should always be called on failure (though the severs will perform automatic cleanup after some time if not)
  await client.cleanup(tss, { signatures }).catch((err)=>{
    throw new Error(`error during cleanup: ${err}`);
  });

  // n) Disconnect client sockets
  sockets.map((soc)=>{
    if (soc && soc.connected) {
      console.log(`closing socket: ${soc.id}`)
      soc.close();
    }
  });
  
  if (!passed) {
    throw new Error("Invalid signature found");
  }

  client.log(`pubkey, ${JSON.stringify(finalTssPubKey)}`);
  client.log(`msgHash: 0x${msgHash.toString("hex")}`);
  client.log(`signature: 0x${signature.r.toString(16, 64)}${signature.s.toString(16, 64)}${new BN(27 + signature.recoveryParam).toString(16)}`);
};

export const tssMPCSigning = async()=>{
  try {
    await runMPCSigning(); 
  } catch (error: unknown) {
    throw error;
  }
};

try {
    tssMPCSigning()
} catch (e: unknown) {
	console.error(e);
}
