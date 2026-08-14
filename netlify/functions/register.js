// netlify/functions/register.js
//
// Receives signup form submissions from the landing page and writes them into
// the "NFL Pick'em Challenge" Airtable base:
//   1. Finds or creates a Members record (matched by email)
//   2. Creates a Pool Memberships record for each pool selected, linked to
//      the 2026 Season record
//
// Required environment variables (set in Netlify: Site settings > Environment variables):
//   AIRTABLE_TOKEN   - Personal access token with data.records:read/write on this base
//   AIRTABLE_BASE_ID - appawwWZcuUTseI77
//
// These IDs are specific to the current base schema. If the schema changes
// (fields renamed/added), update the constants below to match.

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appawwWZcuUTseI77';

const TABLES = {
  members: 'tblnCDedpF9rLKjil',
  poolMemberships: 'tblXGyPjDJHJ4YyyX',
};

const MEMBER_FIELDS = {
  fullName: 'fldRxeVpZVjo2kJCL',
  firstName: 'fldIr56PUQKT9vROF',
  lastName: 'fldYNDmN8Z2KfRaJ3',
  email: 'fld7DKdilLkSUCDLA',
  sleeperUsername: 'fldR3S8SAVdBOCtfb',
  venmoUsername: 'fldjYyyPTwLJFV3Wg',
  active: 'fldMselPqUMA9s8xa',
  joinDate: 'fldbcyN9ydIxyyPmJ',
};

const MEMBERSHIP_FIELDS = {
  membershipId: 'fldexW08IUJJPljkw',
  member: 'fld6QvLxJGih7QhtT',
  pool: 'fldkikHKen2nnrnHW',
  season: 'fldCJ9bwL4kJtpKiD',
  amountPaid: 'fldWeE9S8l6gjekW4',
};

const POOL_NAMES = { otter: 'Otter Club', shark: 'Shark Club' };
const POOL_FEES = { otter: 20, shark: 50 };
const SEASON_LABEL = '2026';
const VENMO_HANDLE = '@Seth-Suntha';
const BREVO_SENDER = { name: "NFL Pick'em Challenge", email: 'seth@pickem-challenge.com' };
const BREVO_REPLY_TO = { email: 'likelinus42@gmail.com', name: 'Seth' };

// 2026 Season record and Pool records — created when the base was set up.
// Update these if a new season/pool record is ever added.
const SEASON_2026_RECORD_ID = 'rec1oa44G6yn4vD3T';
const POOL_RECORD_IDS = {
  otter: 'recVps4a7FWV6SVh8',
  shark: 'recazz9kolIMBkgcD',
};

const AIRTABLE_API = `https://api.airtable.com/v0/${BASE_ID}`;

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function findMemberByEmail(email) {
  const filterFormula = encodeURIComponent(`{Email} = "${email.replace(/"/g, '\\"')}"`);
  const res = await fetch(`${AIRTABLE_API}/${TABLES.members}?filterByFormula=${filterFormula}&maxRecords=1`, {
    headers: airtableHeaders(),
  });
  if (!res.ok) throw new Error(`Airtable lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records[0] || null;
}

async function createMember(payload) {
  const res = await fetch(`${AIRTABLE_API}/${TABLES.members}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({
      records: [{
        fields: {
          [MEMBER_FIELDS.fullName]: `${payload.firstName} ${payload.lastName}`,
          [MEMBER_FIELDS.firstName]: payload.firstName,
          [MEMBER_FIELDS.lastName]: payload.lastName,
          [MEMBER_FIELDS.email]: payload.email,
          [MEMBER_FIELDS.sleeperUsername]: payload.sleeperUsername,
          [MEMBER_FIELDS.venmoUsername]: payload.venmoUsername || '',
          [MEMBER_FIELDS.active]: true,
          [MEMBER_FIELDS.joinDate]: new Date().toISOString().slice(0, 10),
        },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Airtable member create failed: ${res.status}`);
  const data = await res.json();
  return data.records[0];
}

async function createPoolMemberships(memberId, fullName, pools) {
  const records = pools.map((poolKey) => ({
    fields: {
      [MEMBERSHIP_FIELDS.membershipId]: `${fullName} \u2014 ${POOL_NAMES[poolKey]} (${SEASON_LABEL})`,
      [MEMBERSHIP_FIELDS.member]: [memberId],
      [MEMBERSHIP_FIELDS.pool]: [POOL_RECORD_IDS[poolKey]],
      [MEMBERSHIP_FIELDS.season]: [SEASON_2026_RECORD_ID],
      [MEMBERSHIP_FIELDS.amountPaid]: 0, // updated later once dues are collected
    },
  }));

  const res = await fetch(`${AIRTABLE_API}/${TABLES.poolMemberships}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`Airtable membership create failed: ${res.status}`);
  return res.json();
}

const POOL_LOGOS = {
  otter: 'https://pickem-challenge.netlify.app/assets/otter-logo.png',
  shark: 'https://pickem-challenge.netlify.app/assets/shark-logo.png',
};
const POOL_COLORS = { otter: '#e8a23d', shark: '#3ddce8' };
const SITE_URL = 'https://pickem-challenge.netlify.app';

async function sendWelcomeEmail(payload, pools) {
  const total = pools.reduce((sum, p) => sum + POOL_FEES[p], 0);
  const headerColor = pools.length === 1 ? POOL_COLORS[pools[0]] : '#e8a23d';

  const poolLines = pools.map((p) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #eee;">
        <table role="presentation"><tr>
          <td style="padding-right:10px;"><img src="${POOL_LOGOS[p]}" width="32" height="32" alt="${POOL_NAMES[p]} logo" style="display:block; border-radius:7px;"></td>
          <td style="color:#1a1a1a; font-size:15px; font-weight:bold;">${POOL_NAMES[p]}</td>
        </tr></table>
      </td>
      <td style="padding:10px 0; border-bottom:1px solid #eee; color:#1a1a1a; font-size:15px; text-align:right;">$${POOL_FEES[p]}</td>
    </tr>`).join('');

  const venmoNote = `NFL Pick'em Challenge 2026 - ${pools.map((p) => POOL_NAMES[p]).join(' + ')}`;
  const venmoUrl = `https://venmo.com/?txn=pay&audience=friends&recipients=${encodeURIComponent(VENMO_HANDLE.replace('@', ''))}&amount=${total}&note=${encodeURIComponent(venmoNote)}`;

  const html = `
  <div style="background:#f2efea; padding:32px 16px; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:10px; overflow:hidden; border:1px solid #e5e1d8;">
      <tr>
        <td style="background:#0b0e14; padding:0; border-top:4px solid ${headerColor};">
          <table role="presentation" width="100%"><tr>
            <td style="padding:24px 32px;">
              <span style="color:${headerColor}; font-weight:bold; font-size:13px; letter-spacing:1px; text-transform:uppercase;">2026 Season</span>
              <h1 style="color:#f2efea; font-size:22px; margin:8px 0 0;">You're in, ${payload.firstName}!</h1>
            </td>
            <td style="padding:24px 32px 24px 0; text-align:right; white-space:nowrap;">
              ${pools.map((p) => `<img src="${POOL_LOGOS[p]}" width="44" height="44" alt="${POOL_NAMES[p]} logo" style="display:inline-block; border-radius:9px; margin-left:6px;">`).join('')}
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <p style="color:#333; font-size:15px; line-height:1.6; margin:0 0 20px;">
            Thanks for joining the NFL Pick'em Challenge. Here's what you signed up for:
          </p>
          <table role="presentation" width="100%" style="margin-bottom:24px;">
            ${poolLines}
            <tr>
              <td style="padding:12px 0 0; color:#1a1a1a; font-size:16px; font-weight:bold;">Total due</td>
              <td style="padding:12px 0 0; color:#1a1a1a; font-size:16px; font-weight:bold; text-align:right;">$${total}</td>
            </tr>
          </table>

          <table role="presentation" width="100%" style="margin-bottom:24px;">
            <tr>
              <td align="center" style="border-radius:8px; background:${headerColor};">
                <a href="${venmoUrl}" style="display:block; padding:14px 24px; color:#171006; font-size:15px; font-weight:bold; text-decoration:none; font-family:Arial, Helvetica, sans-serif;">
                  Pay $${total} on Venmo &rarr;
                </a>
              </td>
            </tr>
          </table>
          <p style="color:#999; font-size:12px; line-height:1.5; margin:0 0 24px; text-align:center;">
            Opens Venmo with ${VENMO_HANDLE} and $${total} pre-filled. Please pay before kickoff of Week 1.
          </p>

          <p style="color:#333; font-size:15px; line-height:1.6; margin:0 0 20px;">
            Next, you'll get a separate invite to join the pool(s) in Sleeper, that's where you'll make your weekly picks. Hang tight for that.
          </p>
          <p style="color:#666; font-size:13px; line-height:1.6; margin:24px 0 0;">
            Questions? Just reply to this email.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8f7f4; padding:18px 32px; text-align:center; border-top:1px solid #eee;">
          <a href="${SITE_URL}" style="color:#999; font-size:12px; text-decoration:none;">NFL Pick'em Challenge</a>
          <span style="color:#ccc; font-size:12px;"> &middot; </span>
          <span style="color:#999; font-size:12px;">Not affiliated with the NFL or Sleeper</span>
        </td>
      </tr>
    </table>
  </div>`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: BREVO_SENDER,
      to: [{ email: payload.email, name: `${payload.firstName} ${payload.lastName}` }],
      replyTo: BREVO_REPLY_TO,
      subject: `You're in for the NFL Pick'em Challenge, ${payload.firstName}!`,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo send failed: ${res.status} ${errText}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { firstName, lastName, email, sleeperUsername, venmoUsername, pools } = payload;
  if (!firstName || !lastName || !email || !sleeperUsername || !venmoUsername || !Array.isArray(pools) || pools.length === 0) {
    return { statusCode: 400, body: 'Missing required fields' };
  }
  const validPools = pools.filter((p) => POOL_RECORD_IDS[p]);
  if (validPools.length === 0) {
    return { statusCode: 400, body: 'No valid pool selected' };
  }

  try {
    let member = await findMemberByEmail(email);
    if (!member) {
      member = await createMember(payload);
    }
    const memberFullName = (member.fields && member.fields['Full Name']) || `${firstName} ${lastName}`;
    await createPoolMemberships(member.id, memberFullName, validPools);

    try {
      await sendWelcomeEmail(payload, validPools);
    } catch (emailErr) {
      // Don't fail the whole signup just because the email didn't send.
      console.error('Welcome email failed:', emailErr);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, memberId: member.id }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
