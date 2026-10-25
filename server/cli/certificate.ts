import "server-only";
import { chmodSync, chownSync, mkdirSync, writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { generate } from "selfsigned";

export const DEFAULT_CERTIFICATE_DAYS = 825;

export interface SubjectAltNames {
  dnsNames: string[];
  ipAddresses: string[];
}

/** SAN `type` numbers from RFC 5280 (what `selfsigned` expects). */
const DNS_NAME_TYPE = 2 as const;
const IP_ADDRESS_TYPE = 7 as const;

/**
 * The names a browser may use to reach this server: the host name (and `<name>.local` for mDNS),
 * `localhost`, and every interface address (link-local IPv6 addresses left out, as browsers can't
 * use them in a URL without a zone).
 */
export function collectSubjectAltNames(
  hostName: string,
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): SubjectAltNames {
  const shortName = hostName.trim().toLowerCase();
  const dnsNames = new Set<string>();
  if (shortName) {
    dnsNames.add(shortName);
    if (!shortName.includes(".")) dnsNames.add(`${shortName}.local`);
  }
  dnsNames.add("localhost");
  const ipAddresses = new Set<string>(["127.0.0.1", "::1"]);
  for (const interfaceAddresses of Object.values(networkInterfaces)) {
    for (const interfaceAddress of interfaceAddresses ?? []) {
      if (interfaceAddress.family === "IPv6" && interfaceAddress.address.toLowerCase().startsWith("fe80:")) continue;
      ipAddresses.add(interfaceAddress.address);
    }
  }
  return { dnsNames: [...dnsNames], ipAddresses: [...ipAddresses] };
}

export interface CertificateRequest {
  hostName: string;
  days: number;
  altNames: SubjectAltNames;
  now?: Date;
}

export interface CertificatePair {
  certificatePem: string;
  keyPem: string;
}

/** A self-signed server certificate (RSA 2048, SHA-256), made offline with `selfsigned`. */
export async function generateSelfSignedCertificate({
  hostName,
  days,
  altNames,
  now = new Date(),
}: CertificateRequest): Promise<CertificatePair> {
  const notAfterDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const pems = await generate([{ name: "commonName", value: hostName || "localhost" }], {
    keyType: "rsa",
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: now,
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          ...altNames.dnsNames.map((dnsName) => ({ type: DNS_NAME_TYPE, value: dnsName })),
          ...altNames.ipAddresses.map((ipAddress) => ({ type: IP_ADDRESS_TYPE, ip: ipAddress })),
        ],
      },
    ],
  });
  return { certificatePem: pems.cert, keyPem: pems.private };
}

export interface CertificateFiles {
  tlsDirectory: string;
  certificateFile: string;
  keyFile: string;
  /** The service account's group; when set (running as root), the folder and key become root:<group>. */
  serviceGroupId?: number;
}

/** Writes `cert.pem` (0644) and `key.pem` (0640, root:cmm) into `/etc/cmm/tls` (0750, root:cmm). */
export function writeCertificateFiles(files: CertificateFiles, certificatePair: CertificatePair): void {
  mkdirSync(files.tlsDirectory, { recursive: true, mode: 0o750 });
  chmodSync(files.tlsDirectory, 0o750);
  writeFileSync(files.certificateFile, certificatePair.certificatePem, { mode: 0o644 });
  chmodSync(files.certificateFile, 0o644);
  writeFileSync(files.keyFile, certificatePair.keyPem, { mode: 0o640 });
  chmodSync(files.keyFile, 0o640);
  if (files.serviceGroupId !== undefined) {
    chownSync(files.tlsDirectory, 0, files.serviceGroupId);
    chownSync(files.keyFile, 0, files.serviceGroupId);
  }
}
