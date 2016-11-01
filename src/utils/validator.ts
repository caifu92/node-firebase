import url = require('url');

/**
 * Validates that a string is alpha numeric.
 *
 * @param {any} alphanumeric The string to validate.
 * @return {boolean} Whether the string is alpha-numeric or not.
 */
export function isAlphanumeric(alphanumeric: any): boolean {
  if (typeof alphanumeric !== 'string') {
    return false;
  }
  let re = /^[a-zA-Z0-9]*$/;
  return re.test(alphanumeric);
}


/**
 * Validates that a string is a valid Firebase Auth uid.
 *
 * @param {any} uid The string to validate.
 * @return {boolean} Whether the string is a valid Firebase Auth uid.
 */
export function isUid(uid: any): boolean {
  // A uid should be an alphanumeric string with up to 128 characters.
  return isAlphanumeric(uid) && uid.length > 0 && uid.length <= 128;
}


/**
 * Validates that a string is a valid Firebase Auth password.
 *
 * @param {any} password The password string to validate.
 * @return {boolean} Whether the string is a valid Firebase Auth password.
 */
export function isPassword(password: any): boolean {
  // A password must be a string of at least 6 characters.
  return typeof password === 'string' && password.length >= 6;
}


/**
 * Validates that a string is a valid email.
 *
 * @param {any} email The string to validate.
 * @return {boolean} Whether the string is valid email or not.
 */
export function isEmail(email: any): boolean {
  if (typeof email !== 'string') {
    return false;
  }
  // There must at least one character before the @ symbol and another after.
  let re = /^[^@]+@[^@]+$/;
  return re.test(email);
}


/**
 * Validates that a string is a valid web URL.
 *
 * @param {any} urlStr The string to validate.
 * @return {boolean} Whether the string is valid web URL or not.
 */
export function isURL(urlStr: any): boolean {
  if (typeof urlStr !== 'string') {
    return false;
  }
  // Lookup illegal characters.
  let re = /[^a-z0-9\:\/\?\#\[\]\@\!\$\&\'\(\)\*\+\,\;\=\.\-\_\~\%]/i;
  if (re.test(urlStr)) {
    return false;
  }
  try {
    let uri = url.parse(urlStr);
    let scheme = uri.protocol;
    let slashes = uri.slashes;
    let hostname = uri.hostname;
    let pathname = uri.pathname;
    if ((scheme !== 'http:' && scheme !== 'https:') || !slashes) {
      return false;
    }
    // Validate hostname.
    if (!/^\w+([\.-]?\w+)*$/.test(hostname)) {
      return false;
    }
    // Validate pathname.
    if (pathname &&
        pathname !== '/' &&
        !/^(\/[\w\-]+([\.]?[\w\-]+)*)*$/.test(pathname)) {
      return false;
    }
    // Allow any query string and hash as long as no invalid character is used.
  } catch (e) {
    return false;
  }
  return true;
}
