import { getAuthenticatedClient } from './gbpAuth';

// Lists Business Profile accounts and their locations - good connection test, and gives us
// the location "name" (resource id) needed for the Performance API later.
async function listAccountsAndLocations() {
  const auth = await getAuthenticatedClient();
  const accessToken = (await auth.getAccessToken()).token;

  const accountsRes = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const accountsJson = await accountsRes.json();
  if (!accountsRes.ok) {
    throw new Error(`GBP accounts error: ${accountsJson.error?.message || accountsRes.status}`);
  }

  const accounts = accountsJson.accounts || [];
  const results: any[] = [];

  for (const account of accounts) {
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const locJson = await locRes.json();
    results.push({
      account: account.name,
      accountName: account.accountName,
      locations: locRes.ok ? locJson.locations || [] : [],
      locationsError: locRes.ok ? null : locJson.error?.message,
    });
  }

  return results;
}

export { listAccountsAndLocations };
