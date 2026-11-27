/**
 * Addresses that look like a Google profile photo but are not one the rules may accept (T29 W3):
 * another host, credentials, a port, another scheme, upper case, a trailing dot, look-alike
 * separators, no path, or characters the photo pattern refuses. Shared by the inbox (fromPhoto)
 * and own-routine (receivedFrom.photo) rules tests, from the T29 verifier's probes (L78).
 */
export const photoLookAlikes = [
  "https://googleusercontent.com.evil.com/a",
  "https://lh3.googleusercontent.com@evil.com/a",
  "https://evilgoogleusercontent.com/a",
  "https://lh3.googleusercontent.com:443/a",
  "http://lh3.googleusercontent.com/a",
  "https://a@lh3.googleusercontent.com/a",
  "https://LH3.GOOGLEUSERCONTENT.COM/a",
  "https://lh3.googleusercontent.com./a",
  "https://lh3.googleusercontent.com\\@evil.com/a",
  "https://lh3.googleusercontent\u3002com/a",
  "https://lh3.googleusercontent.com?x=/a",
  "https://lh3.googleusercontent.com#/a",
  "https://lh3.googleusercontent.com",
  "https://lh3_x.googleusercontent.com/a",
  "//lh3.googleusercontent.com/a",
  " https://lh3.googleusercontent.com/a",
  "https://lh3.googleusercontent.com/a\n",
  "data:image/png;base64,AAAA",
  "https://lh3.googleusercontent.com/a b",
];
