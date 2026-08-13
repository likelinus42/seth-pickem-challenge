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
const SEASON_LABEL = '2026';

// 2026 Season record and Pool records — created when the base was set up.
// Update these if a new season/pool record is ever added.
const SEASON_2026_RECORD_ID = 'rec1oa44G6yn4vD3T';
const POOL_RECORD_IDS = {
  otter: 'recVps4a7FWV6SVh8',
  shark: 'recazz9kolIMBkgcD',
};
const POOL_FEES = { otter: 20, shark: 50 };

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

  const { firstName, lastName, email, sleeperUsername, pools } = payload;
  if (!firstName || !lastName || !email || !sleeperUsername || !Array.isArray(pools) || pools.length === 0) {
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
    await createPoolMemberships(member.id, `${firstName} ${lastName}`, validPools);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, memberId: member.id }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
