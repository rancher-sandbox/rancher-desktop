/*
Copyright © 2022 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Some code is derived from node-forge:

New BSD License (3-clause)
Copyright (c) 2010, Digital Bazaar, Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of Digital Bazaar, Inc. nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL DIGITAL BAZAAR BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

import forge from 'node-forge';

import Logging from '@pkg/utils/logging';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.background;
const { asn1 } = forge;

const x509CertificateValidityValidator = {
  name:        'Certificate',
  tagClass:    asn1.Class.UNIVERSAL,
  type:        asn1.Type.SEQUENCE,
  constructed: true,
  value:       [{
    name:        'Certificate.TBSCertificate',
    tagClass:    asn1.Class.UNIVERSAL,
    type:        asn1.Type.SEQUENCE,
    constructed: true,
    value:       [{
      name:        'Certificate.TBSCertificate.version',
      tagClass:    asn1.Class.CONTEXT_SPECIFIC,
      type:        0,
      constructed: true,
      optional:    true,
      value:       [{
        name:        'Certificate.TBSCertificate.version.integer',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.INTEGER,
        constructed: false,
      }],
    }, {
      name:        'Certificate.TBSCertificate.serialNumber',
      tagClass:    asn1.Class.UNIVERSAL,
      type:        asn1.Type.INTEGER,
      constructed: false,
    }, {
      name:        'Certificate.TBSCertificate.signature',
      tagClass:    asn1.Class.UNIVERSAL,
      type:        asn1.Type.SEQUENCE,
      constructed: true,
      value:       [{
        name:        'Certificate.TBSCertificate.signature.algorithm',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.OID,
        constructed: false,
      }, {
        name:     'Certificate.TBSCertificate.signature.parameters',
        tagClass: asn1.Class.UNIVERSAL,
        optional: true,
      }],
    }, {
      name:        'Certificate.TBSCertificate.issuer',
      tagClass:    asn1.Class.UNIVERSAL,
      type:        asn1.Type.SEQUENCE,
      constructed: true,
      captureAsn1: 'issuerEncoded',
    }, {
      name:        'Certificate.TBSCertificate.validity',
      tagClass:    asn1.Class.UNIVERSAL,
      type:        asn1.Type.SEQUENCE,
      constructed: true,
      // The spec only specifies that there will be two times, each of which may
      // be either UTC or generalized.  We can't guarantee that both times are
      // even in the same format; so we alternate reading UTC and generalized,
      // twice, and only determine the actual value based on what we managed to
      // read out.
      value:       [{
        name:        'Certificate.TBSCertificate.validity.notBefore (utc)',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.UTCTIME,
        constructed: false,
        optional:    true,
        capture:     'validityUTC1',
      }, {
        name:        'Certificate.TBSCertificate.validity.notBefore (generalized)',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.GENERALIZEDTIME,
        constructed: false,
        optional:    true,
        capture:     'validityGeneralized1',
      }, {
        name:        'Certificate.TBSCertificate.validity.notAfter (utc)',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.UTCTIME,
        constructed: false,
        optional:    true,
        capture:     'validityUTC2',
      }, {
        name:        'Certificate.TBSCertificate.validity.notAfter (generalized)',
        tagClass:    asn1.Class.UNIVERSAL,
        type:        asn1.Type.GENERALIZEDTIME,
        constructed: false,
        optional:    true,
        capture:     'validityGeneralized2',
      }],
    }],
  }],
};

/**
 * parseIssuer decodes the ASN.1 encoded issuer and returns a map describing it.
 * @param encoded ASN.1 encoded issuer data.
 */
function parseIssuer(encoded: any): Record<string, string> {
  const decoded: {
        type: string;
        value: string;
        name?: string;
        shortName?: string;
    }[] = (forge.pki as any).RDNAttributesAsArray(encoded);
  const result: Record<string, string> = Object.create({}, {
    toString: {
      enumerable: false,
      value() {
        return this.CN || this.OU || JSON.stringify(this);
      },
    },
  });

  for (const item of decoded) {
    result[item.shortName ?? item.name ?? item.type] = item.value;
  }

  return result;
}

/**
 * Convert the given value to a Date using the given forge.asn1 method.
 */
function convertDate(val: string | undefined, fn: 'utcTimeToDate' | 'generalizedTimeToDate') {
  return val ? (forge.asn1 as any)[fn](val) as Date : undefined;
}

/**
 * Attempts to decode PEM certificate and handle exceptions
 * @param pem PEM file
 * @returns Decoded PEM certificate or null on error
 */
function tryPemDecode(pem: string) {
  try {
    return forge.pem.decode(pem)[0];
  } catch (e) {
    console.error(`Rejecting invalid certificate: encountered errors:`, e);

    return null;
  }
}

/**
 * Check a given PEM certificate to ensure it is within the valid date range.
 * This does _not_ do any other checking of the certificate.
 */
export default function checkCertValidity(pem: string): boolean {
  // Node-forge chokes on non-RSA certificates; so we will need to parse it
  // manually.  Code is based on BSD-3 licensed node-forge (lib/x509.js).

  console.debug('Checking certificate for expiry...');
  const msg = tryPemDecode(pem);

  if (!msg) {
    console.warn('Skipping certificate, cannot decode');

    return false;
  }

  if (!msg.type.endsWith('CERTIFICATE')) {
    console.warn(`Skipping certificate with unknown type ${ msg.type }`);

    return false;
  }
  if (msg.procType?.type === 'ENCRYPTED') {
    console.warn('Skipping encrypted certificate');

    return false;
  }
  const obj = forge.asn1.fromDer(msg.body);
  const capture: {
        validityUTC1?: string;
        validityGeneralized1?: string;
        validityUTC2?: string;
        validityGeneralized2?: string;
        issuerEncoded?: any;
    } = {};
  const errors: string[] = [];
  // @types/node-forge is missing many methods, so we need to cast as any.
  const valid = (forge.asn1 as any).validate(obj, x509CertificateValidityValidator, capture, errors);
  const now = new Date();

  if (!valid) {
    console.warn(`Rejecting invalid certificate: encountered errors:`, errors);

    return false;
  }

  const certInfo = {
    issuer:   parseIssuer(capture.issuerEncoded),
    validity: [
      convertDate(capture.validityUTC1, 'utcTimeToDate'),
      convertDate(capture.validityGeneralized1, 'generalizedTimeToDate'),
      convertDate(capture.validityUTC2, 'utcTimeToDate'),
      convertDate(capture.validityGeneralized2, 'generalizedTimeToDate'),
    ].filter(defined),
  };

  console.debug('Inspecting certificate', certInfo);

  if (certInfo.validity.length !== 2) {
    console.warn(`Certificate has unexpected validity dates:`, certInfo);

    return false;
  }
  // We don't care about notBefore; just check that notAfter is valid.
  if (certInfo.validity[1] < now) {
    console.warn([
      `Rejected cert expired on ${ certInfo.validity[1].toUTCString() }`,
      `issued by ${ certInfo.issuer }`,
    ].join(' '));

    return false;
  }

  return true;
}
