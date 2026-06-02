# Microsoft Graph API Implementation Summary

## Overview
The mailer application has been updated to support **Microsoft Graph API** for sending emails from Microsoft OAuth accounts. This replaces the previous IMAP/SMTP-only OAuth approach with full Graph API integration.

## Configuration

The OAuth client ID and redirect URI are now **configurable via environment variables**:

```bash
# Optional: Override the default Azure app ID
export MICROSOFT_OAUTH_CLIENT_ID="your-azure-app-id"

# Optional: Override the default scopes (defaults to Mail.Send)
export MICROSOFT_OAUTH_SCOPES="offline_access openid profile email Mail.Send"

# Optional: Override the redirect URI
export MICROSOFT_OAUTH_REDIRECT_URI="com.emclient.MailClient://oauth"
```

**Default Values:**
- Client ID: `e9a7fea1-1cc0-4cd9-a31b-9137ca5deedd` (register your own Azure app for production use)
- Redirect URI: `com.emclient.MailClient://oauth`
- Scopes: `offline_access openid profile email Mail.Send`

## Architecture Changes

### 1. **Microsoft OAuth Service** (`src/core/services/microsoftOauthService.js`)

**New Functions:**
- `callGraphApi(accessToken, method, path, body)` - Calls Microsoft Graph API endpoints
- `verifyGraphAccess(accountId)` - Verifies Graph access using `/me` endpoint
- `sendGraphMail(accountId, mailPayload)` - Sends email via Graph API
- `getGraphEmail(data)` - Extracts email from Graph /me response

**Updated Behavior:**
- Token verification now uses `/me` Graph endpoint instead of IMAP XOAUTH2
- Authorization uses Graph Mail.Send scope instead of IMAP/SMTP scopes
- Connection status verification works through Graph API

### 2. **Email Send Service** (`src/core/services/emailSendService.js`)

**New Function:**
- `sendGraphMessage(account, subject, html, text, directives, previewText, recipient, fromAddress)` - Sends via Graph API

**Updated Behavior:**
- Graph protocol accounts now use `microsoftOauthService.sendMail()` instead of SMTP transport
- Graph emails are automatically saved to Sent Items via `saveToSentItems: true`
- Supports attachments, headers, and confidentiality settings

### 3. **Account Diagnostics Service** (`src/core/services/accountsDiagnosticsService.js`)

**Updated Verification:**
- Graph account diagnostics now test via Graph `/me` endpoint instead of IMAP
- Error messages reflect Graph API instead of IMAP XOAUTH2

### 4. **UI/UX** (`src/renderer/pages/AccountsPage.jsx`)

**Updates:**
- Provider label changed from "Microsoft OAuth" to "Microsoft Graph"
- Help text updated: "Microsoft Graph accounts use OAuth authorization and send mail through the Microsoft Graph API."
- Protocol dropdown reflects Graph/OAuth terminology

### 5. **Tests** (`test-oauth-flow.js`)

**Updated Tests:**
- Scope tests verify `Mail.Send` instead of `IMAP.AccessAsUser.All` and `SMTP.Send`
- All 29 OAuth tests pass with Graph API scopes

## Key Features

✅ **Microsoft Graph API Integration**
- Send emails via Microsoft Graph endpoint
- Automatic Sent Items saving
- Full attachment support
- Confidentiality and importance headers

✅ **Environment-Based Configuration**
- Override client ID for your own Azure app
- Customize scopes as needed
- Custom redirect URI support

✅ **Backward Compatible**
- IMAP/SMTP OAuth transport still available via `getSmtpTransportConfig()`
- Existing IMAP config methods untouched
- IMAP-based fallback for backward compatibility

✅ **Secure Token Management**
- Access token caching with 2-minute refresh buffer
- Automatic token refresh when expired
- Invalid grant detection and re-auth prompting

✅ **Better Error Handling**
- Graph-specific error messages
- Separate verification path (Graph vs. IMAP)
- Clear re-authorization flow

## Migration Guide

**For Users:**
1. Create or select Microsoft OAuth account
2. Click "Authorize" to grant Graph API access
3. Account automatically sends via Graph API once authorized

**For Developers:**
1. Set environment variables if using a different Azure app:
   ```bash
   export MICROSOFT_OAUTH_CLIENT_ID="your-app-id"
   export MICROSOFT_OAUTH_SCOPES="offline_access openid profile email Mail.Send"
   ```
2. Existing SMTP OAuth accounts continue to work
3. New accounts with `primaryProtocol: 'graph'` use Graph API

## Testing

Run OAuth flow tests:
```bash
npm test  # or: node test-oauth-flow.js
```

Expected output:
```
Results: 29 passed, 0 failed
```

## Files Modified

- `src/core/services/microsoftOauthService.js` - Graph API support
- `src/core/services/emailSendService.js` - Graph send implementation
- `src/core/services/accountsDiagnosticsService.js` - Graph verification
- `src/renderer/pages/AccountsPage.jsx` - UI updates
- `test-oauth-flow.js` - Graph scope tests

## Next Steps (Optional)

1. **Register your own Azure app** for production use
2. **Implement mail reading** via `/me/messages` endpoint
3. **Add calendar/contacts** integration
4. **Custom application name** in OAuth consent screen
5. **Rate limiting** and retry logic for Graph API

## References

- [Microsoft Graph Mail Send API](https://learn.microsoft.com/en-us/graph/api/user-sendmail)
- [Microsoft Graph User /me endpoint](https://learn.microsoft.com/en-us/graph/api/user-get)
- [OAuth 2.0 PKCE](https://oauth.net/2/pkce/)
