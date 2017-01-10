'use strict';

// Use untyped import syntax for Node built-ins
import fs = require('fs');
import path = require('path');
import https = require('https');

import * as _ from 'lodash';
import {expect} from 'chai';
import * as chai from 'chai';
import * as nock from 'nock';
import * as sinon from 'sinon';
import * as sinonChai from 'sinon-chai';
import * as chaiAsPromised from 'chai-as-promised';

import * as utils from './utils';
import * as mocks from './resources/mocks';

import {Auth, FirebaseAccessToken} from '../src/auth/auth';
import {Certificate, CertCredential} from '../src/auth/credential';
import {FirebaseNamespace} from '../src/firebase-namespace';
import {GoogleOAuthAccessToken} from '../src/auth/credential';
import {FirebaseTokenGenerator} from '../src/auth/token-generator';
import {FirebaseAuthRequestHandler} from '../src/auth/auth-api-request';
import {UserRecord} from '../src/auth/user-record';
import {FirebaseApp, FirebaseAppOptions} from '../src/firebase-app';
import {AuthClientErrorCode, FirebaseAuthError} from '../src/utils/error';

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);

const certPath = path.resolve(__dirname, 'resources/mock.key.json');
const MOCK_CERTIFICATE_OBJECT = JSON.parse(fs.readFileSync(certPath).toString());

const ONE_HOUR_IN_SECONDS = 60 * 60;


/**
 * Returns a new FirebaseApp instance with the provided options.
 *
 * @param {Object} options The options for the FirebaseApp instance to create.
 * @return {FirebaseApp} A new FirebaseApp instance with the provided options.
 */
function createAppWithOptions(options: Object) {
  const mockFirebaseNamespaceInternals = new FirebaseNamespace().INTERNAL;
  return new FirebaseApp(options as FirebaseAppOptions, mocks.appName, mockFirebaseNamespaceInternals);
}

/**
 * Returns a new Auth instance from a service account in object form.
 *
 * @return {Auth} A new Auth instance.
 */
function createAuthWithObject() {
  const app = createAppWithOptions({
    credential: new CertCredential({
      project_id: mocks.projectId,
      private_key: MOCK_CERTIFICATE_OBJECT.private_key,
      client_email: MOCK_CERTIFICATE_OBJECT.client_email,
    }),
  });
  return new Auth(app);
}

/**
 * Returns a new Auth instance from a service account in path form.
 *
 * @return {Auth} A new Auth instance.
 */
function createAuthWithPath() {
  const app = createAppWithOptions({
    credential: new CertCredential(path.resolve(__dirname, 'resources/mock.key.json')),
  });
  return new Auth(app);
}


/**
 * @return {Object} A sample valid server response as returned from getAccountInfo
 *     endpoint.
 */
function getValidGetAccountInfoResponse() {
  let userResponse: Object = {
    localId: 'abcdefghijklmnopqrstuvwxyz',
    email: 'user@gmail.com',
    emailVerified: true,
    displayName: 'John Doe',
    providerUserInfo: [
      {
        providerId: 'google.com',
        displayName: 'John Doe',
        photoUrl: 'https://lh3.googleusercontent.com/1234567890/photo.jpg',
        federatedId: '1234567890',
        email: 'user@gmail.com',
        rawId: '1234567890',
      },
      {
        providerId: 'facebook.com',
        displayName: 'John Smith',
        photoUrl: 'https://facebook.com/0987654321/photo.jpg',
        federatedId: '0987654321',
        email: 'user@facebook.com',
        rawId: '0987654321',
      },
    ],
    photoUrl: 'https://lh3.googleusercontent.com/1234567890/photo.jpg',
    validSince: '1476136676',
    lastLoginAt: '1476235905000',
    createdAt: '1476136676000',
  };
  return {
    kind: 'identitytoolkit#GetAccountInfoResponse',
    users: [userResponse],
  };
}

/**
 * Returns a user record corresponding to the getAccountInfo response.
 *
 * @param {any} serverResponse Raw getAccountInfo response.
 * @return {Object} The corresponding user record.
 */
function getValidUserRecord(serverResponse: any) {
  return new UserRecord(serverResponse.users[0]);
}

/**
 * Noop implementation of Credential.getToken that returns a Promise of null.
 */
class UnauthenticatedCredential {
  public getAccessToken(): Promise<GoogleOAuthAccessToken> {
    return Promise.resolve(null);
  }

  public getCertificate(): Certificate {
    return null;
  }
}

describe('Auth', () => {
  let mockedRequests: nock.Scope[] = [];

  afterEach(() => {
    _.forEach(mockedRequests, (mockedRequest) => mockedRequest.done());
    mockedRequests = [];
  });

  after(() => {
    nock.cleanAll();
  });

  describe('Constructor', () => {
    it('should throw given no app', () => {
      expect(() => {
        // We must defeat the type system to successfully even compile this line.
        const authAny: any = Auth;
        return new authAny();
      }).to.throw('First parameter to Auth constructor must be an instance of FirebaseApp');
    });

    describe('with service account', () => {
      const invalidServiceAccounts = [null, NaN, 0, 1, true, false, '', 'a', [], {}, { a: 1 }, _.noop];
      invalidServiceAccounts.forEach((invalidServiceAccount) => {
        it('should throw given invalid service account: ' + JSON.stringify(invalidServiceAccount), () => {
          const app = createAppWithOptions({
            serviceAccount: invalidServiceAccount,
          });

          expect(() => {
            return new Auth(app);
          }).to.throw(Error);
        });
      });

      it('should throw if service account points to an invalid path', () => {
        const app = createAppWithOptions({
          serviceAccount: 'invalid-file',
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Failed to parse service account key file');
      });

      it('should throw if service account is an empty string', () => {
        const app = createAppWithOptions({
          serviceAccount: '',
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Failed to parse service account key file');
      });

      it('should throw if service account is does not contain a valid "client_email"', () => {
        let app = createAppWithOptions({
          serviceAccount: {
            client_email: '',
            private_key: MOCK_CERTIFICATE_OBJECT.private_key,
          },
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Service account key must contain a string "client_email" field');

        app = createAppWithOptions({
          serviceAccount: {
            private_key: MOCK_CERTIFICATE_OBJECT.private_key,
          },
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Service account key must contain a string "client_email" field');
      });

      it('should throw if service account is does not contain a valid "private_key"', () => {
        let app = createAppWithOptions({
          serviceAccount: {
            client_email: MOCK_CERTIFICATE_OBJECT.client_email,
            private_key: '',
          },
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Service account key must contain a string "private_key" field');

        app = createAppWithOptions({
          serviceAccount: {
            client_email: MOCK_CERTIFICATE_OBJECT.client_email,
          },
        });

        expect(() => {
          return new Auth(app);
        }).to.throw('Service account key must contain a string "private_key" field');
      });

      it('should not throw given a valid path to a service account', () => {
        const app = createAppWithOptions({
          credential: new CertCredential(path.resolve(__dirname, 'resources/mock.key.json')),
        });

        expect(() => {
          return new Auth(app);
        }).not.to.throw();
      });

      it('should not throw given a valid service account object', () => {
        const app = createAppWithOptions({
          credential: new CertCredential({
            private_key: MOCK_CERTIFICATE_OBJECT.private_key,
            client_email: MOCK_CERTIFICATE_OBJECT.client_email,
          }),
        });

        expect(() => {
          return new Auth(app);
        }).not.to.throw();
      });

      it('should accept "clientEmail" in place of "client_email" for the service account', () => {
        const app = createAppWithOptions({
          credential: new CertCredential({
            private_key: MOCK_CERTIFICATE_OBJECT.private_key,
            clientEmail: MOCK_CERTIFICATE_OBJECT.client_email,
          }),
        });

        expect(() => {
          return new Auth(app);
        }).not.to.throw();
      });

      it('should accept "privateKey" in place of "private_key" for the service account', () => {
        const app = createAppWithOptions({
          credential: new CertCredential({
            privateKey: MOCK_CERTIFICATE_OBJECT.private_key,
            client_email: MOCK_CERTIFICATE_OBJECT.client_email,
          }),
        });

        expect(() => {
          return new Auth(app);
        }).not.to.throw();
      });

      it('should not mutate the provided service account object', () => {
        const serviceAccount = {
          privateKey: MOCK_CERTIFICATE_OBJECT.private_key,
          clientEmail: MOCK_CERTIFICATE_OBJECT.client_email,
        };
        const serviceAccountClone = _.clone(serviceAccount);

        const app = createAppWithOptions({
          credential: new CertCredential(serviceAccount),
        });

        expect(() => {
          return new Auth(app);
        }).not.to.throw();

        expect(serviceAccount).to.deep.equal(serviceAccountClone);
      });
    });
  });

  describe('with explicit credentials', () => {
    beforeEach(() => {
      this.clock = sinon.useFakeTimers(1000);
    });

    afterEach(() => {
      this.clock.restore();
    });

    it('should throw if credential is provided but does not conform to Credential', () => {
      let app = createAppWithOptions({
        credential: {} as any,
      });

      expect(() => {
        return new Auth(app);
      }).to.throw('Called initializeApp() with an invalid credential parameter');

      app = createAppWithOptions({
        credential: true as any,
      });

      expect(() => {
        return new Auth(app);
      }).to.throw('Called initializeApp() with an invalid credential parameter');
    });

    it('should cause getToken to cleanly fail if the custom credential returns invalid AccessTokens', () => {
      const credential = {
        getAccessToken: () => 5,
      };

      const app = createAppWithOptions({
        credential: credential as any,
      });

      const auth = new Auth(app);

      return auth.INTERNAL.getToken().then(() => {
        throw new Error('Unexpected success');
      }, (err) => {
        expect(err.toString()).to.include('initializeApp() was called with a credential ' +
        'that creates invalid access tokens');
      });
    });

    it('should accept a well-formed custom credential implementation', () => {
      const oracle: GoogleOAuthAccessToken = {
        access_token: 'This is a custom token',
        expires_in: ONE_HOUR_IN_SECONDS,
      };
      const credential = {
        getAccessToken: () => Promise.resolve(oracle),
      };

      const app = createAppWithOptions({
        credential,
      });

      const auth = new Auth(app);

      return auth.INTERNAL.getToken().then((token) => {
        expect(token.accessToken).to.equal(oracle.access_token);
        expect(+token.expirationTime).to.equal((ONE_HOUR_IN_SECONDS + 1) * 1000);
      });
    });
  });

  describe('app', () => {
    const app = createAppWithOptions({
      credential: new CertCredential(path.resolve(__dirname, 'resources/mock.key.json')),
    });

    it('returns the app from the constructor', () => {
      const auth = new Auth(app);
      // We expect referential equality here
      expect(auth.app).to.equal(app);
    });

    it('is read-only', () => {
      const auth = new Auth(app);
      expect(() => {
        (auth as any).app = app;
      }).to.throw('Cannot set property app of #<Auth> which has only a getter');
    });
  });

  describe('createCustomToken()', () => {
    let spy: sinon.SinonSpy;
    beforeEach(() => {
      spy = sinon.spy(FirebaseTokenGenerator.prototype, 'createCustomToken');
    });

    afterEach(() => {
      spy.restore();
    });

    it('should throw if service account is not specified (and env not set)', () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const app = createAppWithOptions({
        credential: new UnauthenticatedCredential(),
      });
      const auth = new Auth(app);
      expect(() => {
        auth.createCustomToken(mocks.uid, mocks.developerClaims);
      }).to.throw('Must initialize app with a cert credential to call auth().createCustomToken()');
    });

    it('should forward on the call to the token generator\'s createCustomToken() method', () => {
      const auth = createAuthWithObject();
      return auth.createCustomToken(mocks.uid, mocks.developerClaims)
        .then(() => {
          expect(spy)
            .to.have.been.calledOnce
            .and.calledWith(mocks.uid, mocks.developerClaims);
        });
    });
  });

  describe('verifyIdToken()', () => {
    let stub: sinon.SinonStub;
    beforeEach(() => stub = sinon.stub(FirebaseTokenGenerator.prototype, 'verifyIdToken').returns(Promise.resolve()));
    afterEach(() => stub.restore());

    it('should throw if service account is not specified (and env not set)', () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const app = createAppWithOptions({
        credential: new UnauthenticatedCredential(),
      });
      const auth = new Auth(app);
      const mockIdToken = mocks.generateIdToken();
      expect(() => {
        auth.verifyIdToken(mockIdToken);
      }).to.throw('Must initialize app with a cert credential to call auth().verifyIdToken()');
    });

    it('should forward on the call to the token generator\'s verifyIdToken() method', () => {
      const auth = createAuthWithObject();
      const mockIdToken = mocks.generateIdToken();
      return auth.verifyIdToken(mockIdToken).then(() => {
        expect(stub).to.have.been.calledOnce.and.calledWith(mockIdToken);
      });
    });
  });

  describe('getUser()', () => {
    // Mock credential used to initialize the auth instance.
    const accessToken: GoogleOAuthAccessToken = {
      access_token: utils.generateRandomAccessToken(),
      expires_in: ONE_HOUR_IN_SECONDS,
    };
    const credential = {
      getAccessToken: () => Promise.resolve(accessToken),
    };
    const app = createAppWithOptions({
      credential,
    });
    // Initialize all test variables, expected parameters and results.
    const auth = new Auth(app);
    const uid = 'abcdefghijklmnopqrstuvwxyz';
    const expectedGetAccountInfoResult = getValidGetAccountInfoResponse();
    const expectedUserRecord = getValidUserRecord(expectedGetAccountInfoResult);
    const expectedError = new FirebaseAuthError(AuthClientErrorCode.USER_NOT_FOUND);
    // Stubs used to simulate underlying api calls.
    let stubs: sinon.SinonStub[] = [];
    afterEach(() => {
      _.forEach(stubs, (stub) => stub.restore());
    });
    after(() => {
      stubs = [];
    });

    it('should resolve with a UserRecord on success', () => {
      // Stub getAccountInfoByUid to return expected result.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.resolve(expectedGetAccountInfoResult));
      stubs.push(stub);
      return auth.getUser(uid)
        .then((userRecord) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected user record response returned.
          expect(userRecord).to.deep.equal(expectedUserRecord);
        });
    });

    it('should throw an error when the backend returns an error', () => {
      // Stub getAccountInfoByUid to throw a backend error.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.reject(expectedError));
      stubs.push(stub);
      return auth.getUser(uid)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected error returned.
          expect(error).to.equal(expectedError);
        });
    });
  });

  describe('getUserByEmail()', () => {
    // Mock credential used to initialize the auth instance.
    const accessToken: GoogleOAuthAccessToken = {
      access_token: utils.generateRandomAccessToken(),
      expires_in: ONE_HOUR_IN_SECONDS,
    };
    const credential = {
      getAccessToken: () => Promise.resolve(accessToken),
    };
    const app = createAppWithOptions({
      credential,
    });
    // Initialize all test variables, expected parameters and results.
    const auth = new Auth(app);
    const email = 'user@gmail.com';
    const expectedGetAccountInfoResult = getValidGetAccountInfoResponse();
    const expectedUserRecord = getValidUserRecord(expectedGetAccountInfoResult);
    const expectedError = new FirebaseAuthError(AuthClientErrorCode.USER_NOT_FOUND);

    // Stubs used to simulate underlying api calls.
    let stubs: sinon.SinonStub[] = [];
    afterEach(() => {
      _.forEach(stubs, (stub) => stub.restore());
    });
    after(() => {
      stubs = [];
    });

    it('should resolve with a UserRecord on success', () => {
      // Stub getAccountInfoByEmail to return expected result.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByEmail')
        .returns(Promise.resolve(expectedGetAccountInfoResult));
      stubs.push(stub);
      return auth.getUserByEmail(email)
        .then((userRecord) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(email);
          // Confirm expected user record response returned.
          expect(userRecord).to.deep.equal(expectedUserRecord);
        });
    });

    it('should throw an error when the backend returns an error', () => {
      // Stub getAccountInfoByEmail to throw a backend error.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByEmail')
        .returns(Promise.reject(expectedError));
      stubs.push(stub);
      return auth.getUserByEmail(email)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(email);
          // Confirm expected error returned.
          expect(error).to.equal(expectedError);
        });
    });
  });

  describe('deleteUser()', () => {
    // Mock credential used to initialize the auth instance.
    const accessToken: GoogleOAuthAccessToken = {
      access_token: utils.generateRandomAccessToken(),
      expires_in: ONE_HOUR_IN_SECONDS,
    };
    const credential = {
      getAccessToken: () => Promise.resolve(accessToken),
    };
    const app = createAppWithOptions({
      credential,
    });
    // Initialize all test variables, expected parameters and results.
    const auth = new Auth(app);
    const uid = 'abcdefghijklmnopqrstuvwxyz';
    const expectedDeleteAccountResult = {kind: 'identitytoolkit#DeleteAccountResponse'};
    const expectedError = new FirebaseAuthError(AuthClientErrorCode.USER_NOT_FOUND);

    // Stubs used to simulate underlying api calls.
    let stubs: sinon.SinonStub[] = [];
    afterEach(() => {
      _.forEach(stubs, (stub) => stub.restore());
    });
    after(() => {
      stubs = [];
    });

    it('should resolve with void on success', () => {
      // Stub deleteAccount to return expected result.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'deleteAccount')
        .returns(Promise.resolve(expectedDeleteAccountResult));
      stubs.push(stub);
      return auth.deleteUser(uid)
        .then((result) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected result is undefined.
          expect(result).to.be.undefined;
        });
    });

    it('should throw an error when the backend returns an error', () => {
      // Stub deleteAccount to throw a backend error.
      let stub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'deleteAccount')
        .returns(Promise.reject(expectedError));
      stubs.push(stub);
      return auth.deleteUser(uid)
        .then(() => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(stub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected error returned.
          expect(error).to.equal(expectedError);
        });
    });
  });

  describe('createUser()', () => {
    // Mock credential used to initialize the auth instance.
    const accessToken: GoogleOAuthAccessToken = {
      access_token: utils.generateRandomAccessToken(),
      expires_in: ONE_HOUR_IN_SECONDS,
    };
    const credential = {
      getAccessToken: () => Promise.resolve(accessToken),
    };
    const app = createAppWithOptions({
      credential,
    });
    // Initialize all test variables, expected parameters and results.
    const auth = new Auth(app);
    const uid = 'abcdefghijklmnopqrstuvwxyz';
    const expectedGetAccountInfoResult = getValidGetAccountInfoResponse();
    const expectedUserRecord = getValidUserRecord(expectedGetAccountInfoResult);
    const expectedError = new FirebaseAuthError(
      AuthClientErrorCode.INTERNAL_ERROR,
      'Unable to create the user record provided.');
    const unableToCreateUserError = new FirebaseAuthError(
      AuthClientErrorCode.INTERNAL_ERROR,
      'Unable to create the user record provided.');
    const propertiesToCreate = {
      displayName: expectedUserRecord.displayName,
      photoURL: expectedUserRecord.photoURL,
      email: expectedUserRecord.email,
      emailVerified: expectedUserRecord.emailVerified,
      password: 'password',
    };
    // Stubs used to simulate underlying api calls.
    let stubs: sinon.SinonStub[] = [];
    afterEach(() => {
      _.forEach(stubs, (stub) => stub.restore());
    });
    after(() => {
      stubs = [];
    });

    it('should resolve with a UserRecord on createNewAccount request success', () => {
      // Stub createNewAccount to return expected uid.
      let createUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'createNewAccount')
        .returns(Promise.resolve(uid));
      // Stub getAccountInfoByUid to return expected result.
      let getUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.resolve(expectedGetAccountInfoResult));
      stubs.push(createUserStub);
      stubs.push(getUserStub);
      return auth.createUser(propertiesToCreate)
        .then((userRecord) => {
          // Confirm underlying API called with expected parameters.
          expect(createUserStub).to.have.been.calledOnce.and.calledWith(propertiesToCreate);
          expect(getUserStub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected user record response returned.
          expect(userRecord).to.deep.equal(expectedUserRecord);
        });
    });

    it('should throw an error when createNewAccount returns an error', () => {
      // Stub createNewAccount to throw a backend error.
      let createUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'createNewAccount')
        .returns(Promise.reject(expectedError));
      stubs.push(createUserStub);
      return auth.createUser(propertiesToCreate)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(createUserStub).to.have.been.calledOnce.and.calledWith(propertiesToCreate);
          // Confirm expected error returned.
          expect(error).to.equal(expectedError);
        });
    });

    it('should throw an error when getUser returns a User not found error', () => {
      // Stub createNewAccount to return expected uid.
      let createUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'createNewAccount')
        .returns(Promise.resolve(uid));
      // Stub getAccountInfoByUid to throw user not found error.
      let userNotFoundError = new FirebaseAuthError(AuthClientErrorCode.USER_NOT_FOUND);
      let getUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.reject(userNotFoundError));
      stubs.push(createUserStub);
      stubs.push(getUserStub);
      return auth.createUser(propertiesToCreate)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(createUserStub).to.have.been.calledOnce.and.calledWith(propertiesToCreate);
          expect(getUserStub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected error returned.
          expect(error.toString()).to.equal(unableToCreateUserError.toString());
        });
    });

    it('should echo getUser error if an error occurs while retrieving the user record', () => {
      // Stub createNewAccount to return expected uid.
      let createUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'createNewAccount')
        .returns(Promise.resolve(uid));
      // Stub getAccountInfoByUid to throw expected error.
      let getUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.reject(expectedError));
      stubs.push(createUserStub);
      stubs.push(getUserStub);
      return auth.createUser(propertiesToCreate)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(createUserStub).to.have.been.calledOnce.and.calledWith(propertiesToCreate);
          expect(getUserStub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected error returned (same error thrown by getUser).
          expect(error).to.equal(expectedError);
        });
    });
  });

  describe('updateUser()', () => {
    // Mock credential used to initialize the auth instance.
    const accessToken: GoogleOAuthAccessToken = {
      access_token: utils.generateRandomAccessToken(),
      expires_in: ONE_HOUR_IN_SECONDS,
    };
    const credential = {
      getAccessToken: () => Promise.resolve(accessToken),
    };
    const app = createAppWithOptions({
      credential,
    });
    // Initialize all test variables, expected parameters and results.
    const auth = new Auth(app);
    const uid = 'abcdefghijklmnopqrstuvwxyz';
    const expectedGetAccountInfoResult = getValidGetAccountInfoResponse();
    const expectedUserRecord = getValidUserRecord(expectedGetAccountInfoResult);
    const expectedError = new FirebaseAuthError(AuthClientErrorCode.USER_NOT_FOUND);
    const propertiesToEdit = {
      displayName: expectedUserRecord.displayName,
      photoURL: expectedUserRecord.photoURL,
      email: expectedUserRecord.email,
      emailVerified: expectedUserRecord.emailVerified,
      password: 'password',
    };
    // Stubs used to simulate underlying api calls.
    let stubs: sinon.SinonStub[] = [];
    afterEach(() => {
      _.forEach(stubs, (stub) => stub.restore());
    });
    after(() => {
      stubs = [];
    });

    it('should resolve with a UserRecord on updateExistingAccount request success', () => {
      // Stub updateExistingAccount to return expected uid.
      let updateUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'updateExistingAccount')
        .returns(Promise.resolve(uid));
      // Stub getAccountInfoByUid to return expected result.
      let getUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.resolve(expectedGetAccountInfoResult));
      stubs.push(updateUserStub);
      stubs.push(getUserStub);
      return auth.updateUser(uid, propertiesToEdit)
        .then((userRecord) => {
          // Confirm underlying API called with expected parameters.
          expect(updateUserStub).to.have.been.calledOnce.and.calledWith(uid, propertiesToEdit);
          expect(getUserStub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected user record response returned.
          expect(userRecord).to.deep.equal(expectedUserRecord);
        });
    });

    it('should throw an error when updateExistingAccount returns an error', () => {
      // Stub updateExistingAccount to throw a backend error.
      let updateUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'updateExistingAccount')
        .returns(Promise.reject(expectedError));
      stubs.push(updateUserStub);
      return auth.updateUser(uid, propertiesToEdit)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(updateUserStub).to.have.been.calledOnce.and.calledWith(uid, propertiesToEdit);
          // Confirm expected error returned.
          expect(error).to.equal(expectedError);
        });
    });

    it('should echo getUser error if an error occurs while retrieving the user record', () => {
      // Stub updateExistingAccount to return expected uid.
      let updateUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'updateExistingAccount')
        .returns(Promise.resolve(uid));
      // Stub getAccountInfoByUid to throw an expected error.
      let getUserStub = sinon.stub(FirebaseAuthRequestHandler.prototype, 'getAccountInfoByUid')
        .returns(Promise.reject(expectedError));
      stubs.push(updateUserStub);
      stubs.push(getUserStub);
      return auth.updateUser(uid, propertiesToEdit)
        .then((userRecord) => {
          throw new Error('Unexpected success');
        }, (error) => {
          // Confirm underlying API called with expected parameters.
          expect(updateUserStub).to.have.been.calledOnce.and.calledWith(uid, propertiesToEdit);
          expect(getUserStub).to.have.been.calledOnce.and.calledWith(uid);
          // Confirm expected error returned (same error thrown by getUser).
          expect(error).to.equal(expectedError);
        });
    });
  });

  describe('INTERNAL.delete()', () => {
    it('should delete auth instance', () => {
      const auth = createAuthWithObject();
      auth.INTERNAL.delete().should.eventually.be.fulfilled;
    });
  });

  describe('INTERNAL.getToken()', () => {
    let spy: sinon.SinonSpy;

    beforeEach(() => spy = sinon.spy(https, 'request'));
    afterEach(() => spy.restore());

    it('returns a valid token with options object', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      return createAuthWithObject().INTERNAL.getToken().then((token) => {
        expect(token.accessToken).to.be.a('string').and.to.not.be.empty;
      });
    });

    it('returns a valid token with options path', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      return createAuthWithPath().INTERNAL.getToken().then((token) => {
        expect(token.accessToken).to.be.a('string').and.to.not.be.empty;
      });
    });

    it('returns the cached token', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const auth = createAuthWithPath();
      return auth.INTERNAL.getToken().then((token1) => {
        return auth.INTERNAL.getToken().then((token2) => {
          expect(token1.accessToken).to.equal(token2.accessToken);
          expect(https.request).to.have.been.calledOnce;
        });
      });
    });

    it('returns a new token with force refresh', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const auth = createAuthWithPath();
      return auth.INTERNAL.getToken()
        .then((token1) => {
          return auth.INTERNAL.getToken(true).then((token2) => {
            expect(token1.accessToken).to.not.equal(token2.accessToken);
            expect(https.request).to.have.been.calledTwice;
          });
        });
    });
  });

  describe('INTERNAL.addAuthTokenListener()', () => {
    it('does not fire if there is no cached token', () => {
      const events: string[] = [];
      const auth = createAuthWithPath();
      auth.INTERNAL.addAuthTokenListener(events.push.bind(events));
      expect(events).to.be.empty;
    });

    it('is notified when the token changes', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const events: string[] = [];
      const auth = createAuthWithPath();
      auth.INTERNAL.addAuthTokenListener(events.push.bind(events));
      return auth.INTERNAL.getToken().then((token) => {
        expect(events).to.deep.equal([token.accessToken]);
      });
    });

    it('can be called twice', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const events1: string[] = [];
      const events2: string[] = [];
      const auth = createAuthWithPath();
      auth.INTERNAL.addAuthTokenListener(events1.push.bind(events1));
      auth.INTERNAL.addAuthTokenListener(events2.push.bind(events2));
      return auth.INTERNAL.getToken().then((token) => {
        expect(events1).to.deep.equal([token.accessToken]);
        expect(events2).to.deep.equal([token.accessToken]);
      });
    });

    it('will be called on token refresh', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const events: string[] = [];
      const auth = createAuthWithPath();
      auth.INTERNAL.addAuthTokenListener(events.push.bind(events));
      return auth.INTERNAL.getToken().then((token) => {
        expect(events).to.deep.equal([token.accessToken]);
        return auth.INTERNAL.getToken(true).then((newToken) => {
          expect(events).to.deep.equal([token.accessToken, newToken.accessToken]);
        });
      });
    });

    it('will fire with the initial token if it exists', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const auth = createAuthWithPath();
      return auth.INTERNAL.getToken().then(() => {
        return new Promise((resolve) => {
          auth.INTERNAL.addAuthTokenListener(resolve);
        });
      }).should.eventually.be.fulfilled.and.not.be.empty;
    });
  });

  describe('INTERNAL.removeTokenListener()', () => {
    it('removes the listener', () => {
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());
      mockedRequests.push(utils.mockFetchAccessTokenViaJwt());

      const events1: string[] = [];
      const events2: string[] = [];
      const auth = createAuthWithPath();
      const listener1 = (token: string) => { events1.push(token); };
      const listener2 = (token: string) => { events2.push(token); };
      auth.INTERNAL.addAuthTokenListener(listener1);
      auth.INTERNAL.addAuthTokenListener(listener2);
      return auth.INTERNAL.getToken().then((token: FirebaseAccessToken) => {
        expect(events1).to.deep.equal([token.accessToken]);
        expect(events2).to.deep.equal([token.accessToken]);
        auth.INTERNAL.removeAuthTokenListener(listener1);
        return auth.INTERNAL.getToken(true).then((newToken: FirebaseAccessToken) => {
          expect(events1).to.deep.equal([token.accessToken]);
          expect(events2).to.deep.equal([token.accessToken, newToken.accessToken]);
        });
      });
    });
  });
});
