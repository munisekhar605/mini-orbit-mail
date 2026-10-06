import * as crypto from 'crypto';

export interface GeneratedDomainSecurity {
  dkimSelector: string;
  dkimPublicKey: string;
  dkimPrivateKey: string;
  spfRecord: string;
  dmarcRecord: string;
}

export function generateDomainSecurityRecords(
  domainName: string,
  serverIp?: string,
): GeneratedDomainSecurity {
  const dkimSelector = 'default';

  // Generate cryptographically secure 2048-bit RSA keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Extract pure base64 key string for the DNS TXT record
  const cleanPublicKey = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/[\r\n\s]/g, '');

  const dkimRecordValue = `v=DKIM1; k=rsa; p=${cleanPublicKey}`;

  // Build dynamic SPF record with MX and IP if available
  const ipPart = serverIp ? ` ip4:${serverIp}` : '';
  const spfRecord = `v=spf1 mx a:mail.${domainName}${ipPart} ~all`;

  // Build standard RFC 7489 compliant DMARC record
  const dmarcRecord = `v=DMARC1; p=quarantine; pct=100; rua=mailto:postmaster@${domainName}; ruf=mailto:postmaster@${domainName}; fo=1; adkim=r; aspf=r`;

  return {
    dkimSelector,
    dkimPublicKey: dkimRecordValue,
    dkimPrivateKey: privateKey,
    spfRecord,
    dmarcRecord,
  };
}
