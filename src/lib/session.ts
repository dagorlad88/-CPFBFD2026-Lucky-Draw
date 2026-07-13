/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Session = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

/**
 * Extracts session details from HTTP request headers.
 * This is used for apps hosted in environments behind an auth proxy
 * (like AppCentral/AI Studio) which inject user identity headers.
 */
export function sessionFromHeaders(headers: Headers): Session | null {
  const id = headers.get('x-auth-user-id');
  if (!id) return null;
  return {
    id,
    email: headers.get('x-auth-user-email') ?? '',
    name: headers.get('x-auth-user-name') ?? '',
    image: headers.get('x-auth-user-image') || null,
  };
}
