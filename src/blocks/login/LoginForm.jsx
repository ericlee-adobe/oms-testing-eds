import { useState } from 'react';
import { getRSAEncrytpedPasswords } from './encrypt.js';

// Endpoints come from VITE_ env vars (see .env); fallbacks keep the block
// working if a var is missing at build time.
const ACC_ENDPOINT = import.meta.env.VITE_ACC_ENDPOINT ?? 'https://accapi.gp1dev.aws.lge.com';
const ACC_VALIDATION_PATH = import.meta.env.VITE_ACC_VALIDATION_PATH ?? '/sign/api/validationAccount';
const ACC_EMAILCHECK_PATH = import.meta.env.VITE_ACC_EMAILCHECK_PATH ?? '/sign/api/lgEmpEmailCheck';
const ACC_PUBLIC_KEY = import.meta.env.VITE_ACC_PUBLIC_KEY ?? '';

// The browser can never call ACC directly: ACC returns no CORS headers for our
// origins (localhost or *.aem.live), the gp1dev TLS cert doesn't validate, and
// the host is internal. So every request goes through a proxy/BFF that we own,
// which forwards to ACC server-side and adds CORS. Both proxies expose ACC's
// own paths (…/sign/api/…) under their base URL, so only the base differs:
//   - localhost      → local dev proxy (npm run proxy, tools/cors-proxy.mjs)
//   - EDS/preview/prod → hosted proxy (VITE_ACC_PROXY_REMOTE)
// A single committed bundle works everywhere because this resolves at runtime.
const IS_LOCALHOST = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const ACC_PROXY = import.meta.env.VITE_ACC_PROXY ?? 'http://localhost:3001';
// Hosted proxy for non-localhost. Falls back to ACC_ENDPOINT only so the build
// doesn't break when unset — direct ACC calls will still be CORS-blocked until
// this points at a real proxy.
const ACC_PROXY_REMOTE = import.meta.env.VITE_ACC_PROXY_REMOTE || ACC_ENDPOINT;
const API_BASE = IS_LOCALHOST ? ACC_PROXY : ACC_PROXY_REMOTE;
const VALIDATION_URL = `${API_BASE}${ACC_VALIDATION_PATH}`;
const EMAILCHECK_URL = `${API_BASE}${ACC_EMAILCHECK_PATH}`;

// Locale code the ACC API expects (X-Lge-LocaleCode header + payload).
// Mirrors getHeaderValues() in the reference: read from the <html> data attrs.
function getLocaleCode() {
    return document.documentElement.dataset.localeCode || '';
}

// Mirrors simpleUserSignin.js: the "registration requires password" flag comes
// from the <html> data attribute; defaults to 'N'. When 'Y', an existing account
// with no password set (isAddPwYn) routes to a "set password" prompt instead of
// the password step.
function getRegPwFlag() {
    return document.documentElement.dataset.regPwFlag || 'N';
}

// ACCS API Mesh proxy fronting the `ssoLogin` mutation. Same resolve-at-runtime
// switch as the ACC proxy above: localhost talks to the locally-run mesh-proxy
// (http://localhost:5050) while EDS/preview/prod use the hosted one. Both expose
// the same `/graphql` path and add CORS, so one committed bundle works everywhere.
const MESH_PROXY_LOCAL = import.meta.env.VITE_MESH_PROXY_LOCAL ?? 'http://localhost:5050';
const MESH_PROXY_REMOTE = import.meta.env.VITE_MESH_PROXY
    ?? 'https://285361-964browntortoise-stage.adobeio-static.net/api/v1/web/api-mesh/mesh-proxy';
const MESH_PROXY = `${IS_LOCALHOST ? MESH_PROXY_LOCAL : MESH_PROXY_REMOTE}/graphql`;

// Commerce store view code for the mesh `Store` header (UK-only POC). NCMS sends
// the lowercased locale code here (ApolloClientSetup.js / OBSTokenGenerateService).
const STORE_CODE = import.meta.env.VITE_COMMERCE_STORE_CODE ?? 'uk';

// Cookie names mirror NCMS (site/assets/js/common/constant.js) so the rest of the
// storefront treats the customer as signed in: the Commerce customer JWT lives in
// AUTH_TOKEN (sent as `Authorization: Bearer` on later authenticated GraphQL
// calls), with the SSO tokens kept alongside for refresh.
const COOKIE = {
    authToken: 'AUTH_TOKEN',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    cartId: 'LGGP1_CartID',
};

function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
}

function writeCookie(name, value) {
    if (!value) return;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}

// ACCS-native ssoLogin (sso-login-in-accs.md §2). Same request shape NCMS uses
// (OBSTokenGenerateService.java): the SSO access token is the `code`, cartId comes
// from the LGGP1_CartID cookie. ACCS also returns customer_created alongside token.
const SSO_LOGIN_MUTATION = `mutation ($code: String!, $cartId: String, $isCheckoutBuynow: Boolean) {
  ssoLogin(code: $code, cartId: $cartId, isCheckoutBuynow: $isCheckoutBuynow) {
    token
    customer_created
  }
}`;

// Exchange the LG SSO access token for a native Commerce customer token via the
// mesh `ssoLogin` mutation. Returns { token, customer_created }; throws on any
// GraphQL error or a missing token so the caller can surface a clean message.
async function exchangeSsoToken(accessToken) {
    const cartId = readCookie(COOKIE.cartId) || null;

    const response = await fetch(MESH_PROXY, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            store: STORE_CODE,
        },
        body: JSON.stringify({
            query: SSO_LOGIN_MUTATION,
            variables: { code: accessToken, cartId, isCheckoutBuynow: false },
        }),
    });

    const result = await response.json();

    if (result?.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join('; '));
    }

    const ssoResult = result?.data?.ssoLogin;
    if (!ssoResult?.token) {
        throw new Error('ssoLogin returned no Commerce token.');
    }

    return ssoResult;
}

const COUNTRIES = [
    { value: 'GB', label: 'UK' },
    { value: 'IE', label: 'Ireland' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm() {
    // step 1 = enter country + email, step 2 = enter password
    const [step, setStep] = useState(1);

    const [formData, setFormData] = useState({
        country: COUNTRIES[0].value,
        email: '',
        password: '',
    });

    const [showPassword, setShowPassword] = useState(false);
    const [rememberEmail, setRememberEmail] = useState(false);

    const [status, setStatus] = useState({
        loading: false,
        message: '',
        type: '', // 'success' | 'error' | 'warning'
    });

    const emailValid = EMAIL_PATTERN.test(formData.email);
    const passwordValid = formData.password.length > 0;

    function handleChange(event) {
        const { name, value } = event.target;

        setFormData((current) => ({
            ...current,
            [name]: value,
        }));
    }

    async function handleContinue() {
        if (!emailValid) return;

        setStatus({ loading: true, message: '', type: '' });

        try {
            // Step 1 (lgEmpEmailCheck): confirm the email exists as an LG member
            // before revealing the password step. This call only routes the UI —
            // it does NOT authenticate. Authentication happens at step 2
            // (validationAccount), and the SSO tokens it returns are later handed
            // off to the Gp1SSOTokenValidate BFF. Mirrors simpleUserSignin.js
            // `moveToStep2`.
            const regPwFlag = getRegPwFlag();
            const localeCode = getLocaleCode();
            const response = await fetch(EMAILCHECK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Lge-LocaleCode': localeCode,
                },
                body: JSON.stringify({
                    data: {
                        emailAddr: formData.email,
                        countryCode: formData.country,
                        regPwFlag,
                    },
                }),
            });

            const result = await response.json();

            // code 200/success → email exists.
            if (result?.code === 200 && result?.status === 'success') {
                if (regPwFlag === 'Y' && result?.isAddPwYn) {
                    // Account exists but has no password set → "set password" path
                    // (popLoginInfo in the reference).
                    setStatus({
                        loading: false,
                        message: 'This account has no password set. Please set a password to continue.',
                        type: 'warning',
                    });
                    return;
                }
                // Email exists and has a password → reveal the password step.
                setStatus({ loading: false, message: '', type: '' });
                setStep(2);
                return;
            }

            // code 400 → email not usable for sign-in here.
            if (result?.code === 400) {
                if (result?.dupCode === false) {
                    // Email not found → this shopper needs to sign up.
                    setStatus({
                        loading: false,
                        message: 'No account found for this email. Please sign up.',
                        type: 'error',
                    });
                    return;
                }
                // dupCode true → cross-country duplicate registration
                // (popEamilCheckedError in the reference).
                setStatus({
                    loading: false,
                    message: result?.message || 'This email is already registered in another country.',
                    type: 'error',
                });
                return;
            }

            // Any other/unexpected response.
            setStatus({
                loading: false,
                message: result?.message || 'Unable to verify email. Please try again.',
                type: 'error',
            });
        } catch (error) {
            setStatus({ loading: false, message: error.message, type: 'error' });
        }
    }

    function handleEdit(event) {
        event.preventDefault();
        setShowPassword(false);
        setStatus({ loading: false, message: '', type: '' });
        setStep(1);
    }

    function dismissToast() {
        setStatus((current) => ({ ...current, message: '', type: '' }));
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (!passwordValid) return;

        setStatus({ loading: true, message: '', type: '' });

        try {
            // 1. Encrypt credentials: SHA-512 hashes (+ optional RSA-2048).
            const passwords = await getRSAEncrytpedPasswords(
                formData.email,
                formData.password,
                ACC_PUBLIC_KEY,
            );

            // 2. Call ACC validationAccount with the encrypted data.
            const localeCode = getLocaleCode();
            const response = await fetch(VALIDATION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Lge-LocaleCode': localeCode,
                },
                body: JSON.stringify({
                    data: {
                        emailAddr: formData.email,
                        countryCode: formData.country,
                        empPassword: passwords['emp(SHA512 [password])'],
                        lgePassword: passwords['lge(SHA512 [email + password])'],
                        localeCode,
                        remember: rememberEmail ? 'on' : 'off',
                        tdloginType: 'normal',
                        treasureType: 'login',
                        actionType: 'login',
                        wrongCount: 'Y',
                    },
                }),
            });

            const result = await response.json();

            // 3. Success contract mirrors apiRequestStatus(response, true).
            const isSuccess = result?.code === 200
                && result?.status === 'success'
                && result?.data?.result === true;

            if (!isSuccess) {
                const message = result?.data?.error?.message || 'Login failed.';
                setStatus({ loading: false, message, type: 'error' });
                return;
            }

            // 4. Extract the SSO tokens ACC returned.
            const { tokenInfo } = result.data;
            const accessToken = tokenInfo?.accessToken;
            const refreshToken = tokenInfo?.refreshToken;

            if (!accessToken) {
                setStatus({
                    loading: false,
                    message: 'Sign-in succeeded but no SSO access token was returned.',
                    type: 'error',
                });
                return;
            }

            // 5. Exchange the SSO access token for a native Commerce customer
            // token via the mesh `ssoLogin` mutation (NCMS OBSTokenGenerateService
            // equivalent). This is the step that actually logs the customer into
            // Commerce.
            const { token: commerceToken } = await exchangeSsoToken(accessToken);

            // 6. Persist tokens the way NCMS does (ssoConfirmation.js): the
            // Commerce JWT in AUTH_TOKEN — read as `Authorization: Bearer` on all
            // later authenticated GraphQL calls — with the SSO tokens alongside.
            // Writing AUTH_TOKEN is what marks the customer as signed in.
            writeCookie(COOKIE.authToken, commerceToken);
            writeCookie(COOKIE.accessToken, accessToken);
            writeCookie(COOKIE.refreshToken, refreshToken);

            setStatus({ loading: false, message: 'Signed in successfully.', type: 'success' });
        } catch (error) {
            setStatus({ loading: false, message: error.message, type: 'error' });
        }
    }

    return (
        <div className="c-wrapper MBN001">
            <div className="component">
                <div className="cmp-container">
                    <form className="continue-area" onSubmit={handleSubmit} noValidate>
            <div className="continue-box">
                <div className="continue-box__inner active">
                    {/* Step 1: country + email */}
                    <div
                        className={`continue-box__step${step === 1 ? ' active' : ''}`}
                        id="sign-step1"
                        hidden={step !== 1}
                    >
                        <div className="continue-head">
                            <h2 className="continue-title font-family-headline">
                                Enter your email to sign up or sign in
                            </h2>
                        </div>
                        <ul className="continue-check__list">
                            <li>
                                <div className="c-input-bomE">
                                    <select
                                        className="select-bomE"
                                        id="login-country"
                                        name="country"
                                        value={formData.country}
                                        onChange={handleChange}
                                        required
                                    >
                                        {COUNTRIES.map((country) => (
                                            <option key={country.value} value={country.value}>
                                                {country.label}
                                            </option>
                                        ))}
                                    </select>
                                    <label className="label-fix" htmlFor="login-country">
                                        <span className="label-text">Country</span>
                                        <em className="c-required">
                                            *
                                            {' '}
                                            <span className="sr-only">Required fields</span>
                                        </em>
                                    </label>
                                </div>
                            </li>
                            <li>
                                <div className="c-input-bomE">
                                    <input
                                        className="input-animation check-step email-val"
                                        type="email"
                                        id="login-email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        autoComplete="email"
                                        required
                                    />
                                    <label className="label-move" htmlFor="login-email">
                                        <span className="label-text">Email Address</span>
                                        <em className="c-required">
                                            *
                                            {' '}
                                            <span className="sr-only">Required fields</span>
                                        </em>
                                    </label>
                                </div>
                                {formData.email && !emailValid && (
                                    <div className="bomE-warning wa-check">
                                        Enter a valid email address.
                                    </div>
                                )}
                            </li>
                        </ul>
                    </div>

                    {/* Step 2: password */}
                    <div
                        className={`continue-box__step${step === 2 ? ' active' : ''}`}
                        id="sign-step2"
                        hidden={step !== 2}
                    >
                        <div className="continue-head">
                            <h2 className="continue-title font-family-headline">
                                Sign in to
                                {' '}
                                {COUNTRIES.find((c) => c.value === formData.country)?.label}
                                .
                            </h2>
                            <div className="continue-info-block continue-info-block--email">
                                <p className="continue-info-text" id="userMail">
                                    {formData.email}
                                    <a
                                        className="cmp-button c-button c-button--text-underline"
                                        id="mail-change"
                                        href="#"
                                        aria-labelledby="userMail"
                                        onClick={handleEdit}
                                    >
                                        <span className="cmp-button__text">Edit</span>
                                    </a>
                                </p>
                            </div>
                        </div>
                        <ul className="continue-check__list">
                            <li>
                                <div className="c-input-bomE has-side">
                                    <input
                                        className="input-animation check-step"
                                        type={showPassword ? 'text' : 'password'}
                                        id="login-password"
                                        name="password"
                                        value={formData.password}
                                        onChange={handleChange}
                                        autoComplete="current-password"
                                        required
                                    />
                                    <label className="label-move" htmlFor="login-password">
                                        <span className="label-text">Password</span>
                                        <em className="c-required">
                                            *
                                            {' '}
                                            <span className="sr-only">Required fields</span>
                                        </em>
                                    </label>
                                    <div className="c-input-bomE--side">
                                        <button
                                            className="my-form__eye"
                                            type="button"
                                            aria-pressed={showPassword}
                                            onClick={() => setShowPassword((v) => !v)}
                                        >
                                            <span className="sr-only">
                                                Show Password or close button
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <div className="continue-step-bottom">
                        <div className="continue-btn-wrapper">
                            {step === 1 && (
                                <button
                                    className="button-bomE c-button c-button--default w-medium m-medium highlight btn-full btn-next__js"
                                    type="button"
                                    onClick={handleContinue}
                                    disabled={!emailValid || status.loading}
                                >
                                    <span className="button-text">
                                        {status.loading ? 'Checking…' : 'Continue'}
                                    </span>
                                </button>
                            )}
                            {step === 2 && (
                                <button
                                    className="button-bomE c-button c-button--default highlight w-medium btn-full js-btn-signin"
                                    id="signin"
                                    type="submit"
                                    disabled={!passwordValid || status.loading}
                                >
                                    <span className="button-text">
                                        {status.loading ? 'Signing in…' : 'Sign in'}
                                    </span>
                                </button>
                            )}
                        </div>

                        {status.message && (
                            <div
                                className="toast-aria"
                                role="alert"
                                aria-live="assertive"
                                aria-atomic="true"
                            >
                                <ul className="toast-popup" id="sign-help">
                                    <li className={`toast-popup__item toast-popup__item--${status.type}`}>
                                        <div className="toast-popup__container">
                                            <i className={`toast-popup__icon toast-popup__icon--${status.type}`}>
                                                <span className="sr-only">{status.type}</span>
                                            </i>
                                            <div className="toast-popup__title" id="toast-title">
                                                {status.message}
                                            </div>
                                        </div>
                                        <button
                                            className="toast-popup__remove"
                                            type="button"
                                            aria-labelledby="toast-title"
                                            onClick={dismissToast}
                                        >
                                            <span className="sr-only">remove</span>
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        )}

                        <div className="continue-function__box">
                            <div className="c-checkbox-item remember-email">
                                <label className="checkbox" htmlFor="remember-email">
                                    <input
                                        className="remember-email"
                                        type="checkbox"
                                        name="rememberEmail"
                                        id="remember-email"
                                        checked={rememberEmail}
                                        onChange={(e) => setRememberEmail(e.target.checked)}
                                        aria-describedby="remember-email-label"
                                    />
                                    <span className="label" id="remember-email-label">
                                        Remember Email
                                    </span>
                                </label>
                            </div>
                            <a
                                className={`cmp-button c-button c-button--text-underline black forgot-passwd${step === 2 ? '' : ' hidden'}`}
                                href="#"
                            >
                                <span className="cmp-button__text c-button__text">
                                    Forgot password
                                </span>
                            </a>
                        </div>

                        <div className="continue-signup__box">
                            <div className="continue-signup">
                                Get exclusive offers.
                                {' '}
                                <a href="#">Join us!</a>
                            </div>
                        </div>

                        <div className="continue-social__box">
                            <div className="text-divider">
                                <p>or</p>
                            </div>
                            <ul className="my-linkedlogin-icon">
                                {['apple', 'amazon', 'google', 'facebook'].map((provider) => (
                                    <li key={provider}>
                                        <a
                                            className="my-linkedlogin-icon__ico-box"
                                            href="#"
                                            role="button"
                                        >
                                            <i className={`my-linkedlogin-icon__ico my-linkedlogin-icon__ico--${provider}`} />
                                            <span className="sr-only">{provider}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <div className="continue-bottom">
                <div className="continue-bottom__info">
                    <ul className="continue-policy-list">
                        {[
                            'Terms of Use',
                            'Privacy Policy',
                            'Cookie Policy',
                            'Cookie Settings',
                            'Terms and Conditions of Purchase',
                        ].map((policy) => (
                            <li key={policy}>
                                <a
                                    className="cmp-button c-button"
                                    href="#none"
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Opens in a new window"
                                >
                                    {policy}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
