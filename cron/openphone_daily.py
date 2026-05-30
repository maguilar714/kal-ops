#!/usr/bin/env python3
"""
openphone_daily.py — Pull yesterday's call/message activity from OpenPhone for
KAL Attorneys' intake + main office lines, aggregate, and write a JSON file
that the Nain daily brief task consumes.

Usage:
  python3 openphone_daily.py [YYYY-MM-DD]

If no date is given, defaults to yesterday in America/Los_Angeles.

Output:
  /KAL Context/automation/quo-data/{YYYY-MM-DD}.json

v2 — asyncio fetch layer replaces ThreadPoolExecutor for the pull phase.
     All aggregation, Railway, and output schema are unchanged.
"""

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
import urllib.request
import urllib.error

# Single source of truth for "Pacific time" — DST-correct year-round.
LA_TZ = ZoneInfo('America/Los_Angeles')

# ---- Config -----------------------------------------------------------------

def resolve_workspace():
    """Find the KAL Context folder in the Cowork sandbox or on the local Mac."""
    candidates = []

    # Cowork bash sandbox: session folder may be nested under mnt/
    if os.path.isdir('/sessions'):
        for s in os.listdir('/sessions'):
            base = os.path.join('/sessions', s, 'mnt')
            candidates.append(os.path.join(base, 'KAL Context'))
            candidates.append(os.path.join(base, 'Claude Skills', 'CONTEXT', 'KAL Context'))

    # Direct local path on Moises's Mac
    candidates.append(
        '/Users/mambp/Library/CloudStorage/OneDrive-Personal/Documents/Claude Skills/CONTEXT/KAL Context'
    )

    for c in candidates:
        if os.path.isdir(c):
            return c
    return None   # Railway/server runs have no KAL Context folder — that's fine

WS = resolve_workspace()
KEY_PATH = os.path.join(WS, 'automation', '.secrets', 'openphone.key') if WS else None
OUTPUT_DIR = os.path.join(WS, 'automation', 'quo-data') if WS else None

PHONE_NUMBERS = {
    'intakes':     {'id': 'PNlAfwCenc', 'number': '+17148621173', 'label': 'Intakes'},
    'main_office': {'id': 'PNJU1XFAHc', 'number': '+17148817300', 'label': 'Main Office'},
}

USER_TO_REP = {
    'dalia@kalattorneys.com':    'Dalia',
    'carlos@kalattorneys.com':   'Roberto',
    'rudys@kalattorneys.com':    'Rudys',
    'melvin@kalattorneys.com':   'Melvin',
    'andrea.raudez@kalattorneys.com': 'Andrea',
    'isaias@kalattorneys.com':   'Isaias',
    'maria@kalattorneys.com':    'Maria',
    'dalila@kalattorneys.com':   'Dalila',
    'gema@kalattorneys.com':     'Gema',
    'moises@kalattorneys.com':   'Moises',
    'mark@kalattorneys.com':     'Mark',
    'nain@kalattorneys.com':     'Nain',
    'melanny@kalattorneys.com':  'Melanny',
}

CM_EMAILS = {
    'damny@kalattorneys.com',
    'crish@kalattorneys.com',
    'lucy@kalattorneys.com',
    'erick@kalattorneys.com',
    'icela@kalattorneys.com',
    'rashel@kalattorneys.com',
    'jose@kalattorneys.com',
    'ronald@kalattorneys.com',
    'kausar@kalattorneys.com',
    'kiara@kalattorneys.com',
    'eddie@kalattorneys.com',
}

RAILWAY_URL = 'https://kal-ops-production.up.railway.app'

# Server-side secrets (set as env vars on Railway; absent on manual Mac runs).
# When both are present, the extract encrypts its full payload and publishes it
# to Railway. When absent, the script just writes the local JSON file as before.
ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')   # Fernet key for transcript content
SHARED_SECRET = os.environ.get('SHARED_SECRET')     # bearer token for /quo-data endpoint

PHONE_NUMBER_ID_TO_LINE = {v['id']: v['label'] for v in PHONE_NUMBERS.values()}
API_BASE = 'https://api.openphone.com/v1'
MIN_TRANSCRIPT_DURATION_SEC = 30
ASYNC_SEM_LIMIT = 5

# ---- API client (sync, runs in thread-pool executor) ------------------------

API_KEY = None
_executor = None
_sem = None

def _sync_api_get(path, pairs, retries=5):
    """Sync GET. pairs is a list of (key, value) tuples."""
    url = API_BASE + path
    if pairs:
        url += '?' + urlencode(pairs)
    req = urllib.request.Request(url, headers={
        'Authorization': API_KEY,
        'User-Agent': 'KAL-Automation/1.0 (kalattorneys.com)',
        'Accept': 'application/json',
    })
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read().decode('utf-8', errors='replace')
            except Exception:
                pass
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                wait = min(2.0 * (attempt + 1), 8.0)  # 2s, 4s, 6s, 8s — capped
                if e.code == 429:
                    try:
                        ra = float(e.headers.get('Retry-After', 0))
                        if ra > 0:
                            wait = min(ra, 8.0)
                    except Exception:
                        pass
                time.sleep(wait)
                continue
            print(f'  ! HTTP {e.code} on {path}: {body[:200]}', file=sys.stderr)
            return None
        except Exception as e:
            last_err = e
            time.sleep(0.3)
    print(f'  ! Failed after retries on {path}: {last_err}', file=sys.stderr)
    return None

def _params_to_pairs(params):
    if not params:
        return []
    pairs = []
    for k, v in params.items():
        if isinstance(v, list):
            for item in v:
                pairs.append((f'{k}[]', item))
        else:
            pairs.append((k, v))
    return pairs

# ---- Async fetch layer ------------------------------------------------------

async def api_get(path, params=None):
    pairs = _params_to_pairs(params)
    async with _sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, _sync_api_get, path, pairs)

async def paginate_async(path, params=None, max_pages=200):
    items = []
    token = None
    for _ in range(max_pages):
        page_params = dict(params or {})
        if token:
            page_params['pageToken'] = token
        data = await api_get(path, page_params)
        if not data:
            break
        items.extend(data.get('data', []))
        token = data.get('nextPageToken')
        if not token:
            break
    return items

# ---- Date helpers -----------------------------------------------------------

def pacific_day_window(date_yyyymmdd):
    # Midnight-to-midnight in America/Los_Angeles, DST-aware. zoneinfo applies
    # the correct UTC offset (-08:00 PST / -07:00 PDT) for the given date.
    y, m, d = (int(x) for x in date_yyyymmdd.split('-'))
    start = datetime(y, m, d, 0, 0, 0, tzinfo=LA_TZ)
    end = start + timedelta(days=1)
    return (
        start.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        end.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    )

def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None

# ---- Pull layer (async) -----------------------------------------------------

async def list_active_conversations(phone_number_e164, day_start_utc, day_end_utc):
    return await paginate_async(
        '/conversations',
        params={
            'phoneNumbers': [phone_number_e164],
            'maxResults': 100,
            'updatedAfter': day_start_utc,
            'updatedBefore': day_end_utc,
        },
        max_pages=20,
    )

async def list_calls_for_participant(phone_number_id, participant, since_utc, until_utc):
    return await paginate_async(
        '/calls',
        params={
            'phoneNumberId': phone_number_id,
            'participants': [participant],
            'createdAfter': since_utc,
            'createdBefore': until_utc,
            'maxResults': 50,
        },
    )

async def list_messages_for_participant(phone_number_id, participant, since_utc, until_utc):
    return await paginate_async(
        '/messages',
        params={
            'phoneNumberId': phone_number_id,
            'participants': [participant],
            'createdAfter': since_utc,
            'createdBefore': until_utc,
            'maxResults': 50,
        },
    )

async def get_call_transcript(call_id):
    return await api_get(f'/call-transcripts/{call_id}')

async def get_call_summary(call_id):
    return await api_get(f'/call-summaries/{call_id}')

# ---- Aggregation (unchanged from v1) ----------------------------------------

def empty_user_stats():
    return {
        'name': None,
        'calls': {
            'outgoing': 0, 'incoming_answered': 0,
            'convos_60s': 0, 'deep_convos_180s': 0,
            'avg_duration_sec': 0, 'total_minutes': 0,
        },
        'messages': {'outgoing': 0, 'incoming': 0},
    }

def aggregate(date_yyyymmdd, line_label, calls, messages):
    per_user = {}
    inbound_answered = []
    inbound_missed = 0
    voicemails = 0
    out_total = 0
    in_total = 0

    for c in calls:
        user = c.get('userId')
        answered_by = c.get('answeredBy')
        direction = c.get('direction')
        duration = c.get('duration') or 0
        status = c.get('status')

        if direction == 'outgoing':
            out_total += 1
            email = id_to_email(user)
            if email:
                u = per_user.setdefault(email, empty_user_stats())
                u['name'] = USER_TO_REP.get(email, email)
                u['calls']['outgoing'] += 1
                if duration >= 60:
                    u['calls']['convos_60s'] += 1
                if duration >= 180:
                    u['calls']['deep_convos_180s'] += 1
                u['calls']['total_minutes'] = round(u['calls']['total_minutes'] + duration / 60.0, 1)
        elif direction == 'incoming':
            in_total += 1
            if status == 'completed' or answered_by:
                ab_email = id_to_email(answered_by) if answered_by else None
                if ab_email:
                    u = per_user.setdefault(ab_email, empty_user_stats())
                    u['name'] = USER_TO_REP.get(ab_email, ab_email)
                    u['calls']['incoming_answered'] += 1
                    inbound_answered.append({'answered_by': ab_email, 'name': USER_TO_REP.get(ab_email, ab_email), 'call_id': c.get('id')})
                else:
                    inbound_answered.append({'answered_by': None, 'name': 'Unknown', 'call_id': c.get('id')})
            elif status in ('missed', 'no-answer'):
                inbound_missed += 1
            elif status == 'voicemail':
                voicemails += 1

    for email, u in per_user.items():
        out_calls_for_user = [c for c in calls
                              if c.get('userId') and id_to_email(c['userId']) == email
                              and c.get('direction') == 'outgoing']
        if out_calls_for_user:
            total_sec = sum((c.get('duration') or 0) for c in out_calls_for_user)
            u['calls']['avg_duration_sec'] = int(round(total_sec / len(out_calls_for_user)))

    msg_out = 0
    msg_in = 0
    for m in messages:
        direction = m.get('direction')
        if direction == 'outgoing':
            msg_out += 1
            email = id_to_email(m.get('userId')) or _email_from_user_field(m)
            if email:
                u = per_user.setdefault(email, empty_user_stats())
                u['name'] = USER_TO_REP.get(email, email)
                u['messages']['outgoing'] += 1
        elif direction == 'incoming':
            msg_in += 1

    return {
        'line': line_label,
        'totals': {
            'calls': {
                'total': out_total + in_total,
                'outgoing': out_total,
                'incoming': in_total,
                'incoming_answered': sum(1 for x in inbound_answered if x['answered_by']),
                'incoming_missed': inbound_missed,
                'voicemails': voicemails,
            },
            'messages': {'total': msg_out + msg_in, 'outgoing': msg_out, 'incoming': msg_in},
        },
        'per_user': per_user,
        'inbound_attribution': summarize_attribution(inbound_answered),
    }

# User ID → email cache
_USER_CACHE = None

def _load_user_cache():
    global _USER_CACHE
    if _USER_CACHE is not None:
        return _USER_CACHE
    _USER_CACHE = {}
    token = None
    for _ in range(10):
        pairs = [('maxResults', '50')]
        if token:
            pairs.append(('pageToken', token))
        data = _sync_api_get('/users', pairs)
        if not data:
            break
        for u in data.get('data', []):
            if u.get('id') and u.get('email'):
                _USER_CACHE[u['id']] = u['email']
        token = data.get('nextPageToken')
        if not token:
            break
    return _USER_CACHE

def id_to_email(user_id):
    if not user_id:
        return None
    if '@' in user_id:
        return user_id
    return _load_user_cache().get(user_id)

def _email_from_user_field(record):
    u = record.get('user')
    if isinstance(u, dict) and u.get('email'):
        return u['email']
    return None

def summarize_attribution(records):
    counts = {}
    for r in records:
        key = r['answered_by'] or 'Unknown'
        counts[key] = counts.get(key, 0) + 1
    return [
        {'answered_by': k, 'name': USER_TO_REP.get(k, k) if k != 'Unknown' else 'Unknown', 'count': v}
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1])
    ]

def merge_lines(line_data):
    merged_per_user = {}
    inbound = {}
    totals_calls = {'total': 0, 'outgoing': 0, 'incoming': 0, 'incoming_answered': 0, 'incoming_missed': 0, 'voicemails': 0}
    totals_msgs = {'total': 0, 'outgoing': 0, 'incoming': 0}

    for line in line_data:
        for k, v in line['totals']['calls'].items():
            totals_calls[k] = totals_calls.get(k, 0) + v
        for k, v in line['totals']['messages'].items():
            totals_msgs[k] = totals_msgs.get(k, 0) + v
        for email, u in line['per_user'].items():
            mu = merged_per_user.setdefault(email, empty_user_stats())
            mu['name'] = u['name']
            for stat_block in ('calls', 'messages'):
                for k, v in u[stat_block].items():
                    if k == 'avg_duration_sec':
                        continue
                    mu[stat_block][k] = mu[stat_block].get(k, 0) + v
        for rec in line['inbound_attribution']:
            key = rec['answered_by']
            inbound[key] = inbound.get(key, 0) + rec['count']

    return {
        'totals': {'calls': totals_calls, 'messages': totals_msgs},
        'per_user': merged_per_user,
        'inbound_attribution': [
            {'answered_by': k, 'name': USER_TO_REP.get(k, k) if k != 'Unknown' else 'Unknown', 'count': v}
            for k, v in sorted(inbound.items(), key=lambda kv: -kv[1])
        ],
    }

def top_calls(calls, n=5):
    out = []
    for c in sorted(calls, key=lambda c: -(c.get('duration') or 0))[:n]:
        email = id_to_email(c.get('userId'))
        out.append({
            'call_id': c.get('id'),
            'user': email,
            'rep_name': USER_TO_REP.get(email, email) if email else None,
            'direction': c.get('direction'),
            'duration_sec': c.get('duration'),
            'started_at': c.get('createdAt'),
            'participants': c.get('participants'),
        })
    return out

# ---- Async pipeline ---------------------------------------------------------

async def collect_for_line(phone_meta, since_utc, until_utc):
    print(f'  > {phone_meta["label"]} ({phone_meta["number"]})', file=sys.stderr)
    convos = await list_active_conversations(phone_meta['number'], since_utc, until_utc)
    print(f'    conversations active in window: {len(convos)}', file=sys.stderr)

    participants = set()
    for c in convos:
        for p in (c.get('participants') or []):
            if p and p != phone_meta['number']:
                participants.add(p)
    print(f'    unique participants: {len(participants)}', file=sys.stderr)

    call_tasks = [list_calls_for_participant(phone_meta['id'], p, since_utc, until_utc) for p in participants]
    call_results = await asyncio.gather(*call_tasks)
    all_calls = list({c['id']: c for r in call_results for c in r}.values())
    print(f'    calls: {len(all_calls)}  t={time.time()-_t0:.0f}s', file=sys.stderr)
    return all_calls, []   # messages skipped — not used by downstream briefs

async def fetch_transcripts_async(calls, min_duration=MIN_TRANSCRIPT_DURATION_SEC):
    eligible = sorted(
        [c for c in calls if (c.get('duration') or 0) >= min_duration],
        key=lambda c: -(c.get('duration') or 0)
    )   # no cap — Railway cron has no 45s timeout; fetch every eligible call
    print(f'  > fetching transcripts/summaries for {len(eligible)} calls (>= {min_duration}s)...', file=sys.stderr)

    async def fetch_one(c):
        cid = c['id']
        tr, sm = await asyncio.gather(get_call_transcript(cid), get_call_summary(cid))
        transcript_text = ''
        if tr and tr.get('data', {}).get('dialogue'):
            transcript_text = '\n'.join(
                f"{seg.get('identifier','?')}: {seg.get('content','')}"
                for seg in tr['data']['dialogue']
            )
        summary_text = ''
        if sm and sm.get('data'):
            summary_text = ' '.join(sm['data'].get('summary') or [])
        if not (transcript_text or summary_text):
            return None
        email = id_to_email(c.get('userId'))
        answered_by_email = id_to_email(c.get('answeredBy')) if c.get('answeredBy') else None
        return {
            'call_id': cid,
            'line': PHONE_NUMBER_ID_TO_LINE.get(c.get('phoneNumberId'), 'Unknown'),
            'user': email,
            'answered_by': answered_by_email,
            'rep_name': USER_TO_REP.get(answered_by_email or email or '', answered_by_email or email),
            'direction': c.get('direction'),
            'duration_sec': c.get('duration'),
            'started_at': c.get('createdAt'),
            'participants': c.get('participants'),
            'transcript_text': transcript_text,
            'summary': summary_text,
            'next_steps': (sm.get('data', {}).get('nextSteps') or []) if sm else [],
        }

    results = await asyncio.gather(*[fetch_one(c) for c in eligible])
    return [r for r in results if r]

# ---- Entrypoint -------------------------------------------------------------

def yesterday_pt():
    # "Yesterday" relative to the current wall-clock day in Pacific time,
    # DST-correct year-round via zoneinfo.
    now_pt = datetime.now(LA_TZ)
    return (now_pt - timedelta(days=1)).strftime('%Y-%m-%d')

async def async_main(target):
    global _sem, _t0
    _sem = asyncio.Semaphore(ASYNC_SEM_LIMIT)
    t0 = time.time()
    _t0 = t0
    since, until = pacific_day_window(target)
    print(f'OpenPhone daily extract: {target} ({since} -> {until})', file=sys.stderr)

    # Both lines in parallel
    results = await asyncio.gather(*[
        collect_for_line(meta, since, until)
        for meta in PHONE_NUMBERS.values()
    ])

    line_aggregates = []
    all_calls = []
    all_messages = []
    for meta, (calls, messages) in zip(PHONE_NUMBERS.values(), results):
        agg = aggregate(target, meta['label'], calls, messages)
        line_aggregates.append(agg)
        all_calls.extend(calls)
        all_messages.extend(messages)

    merged = merge_lines(line_aggregates)

    # Recompute per-user avg_duration_sec across both lines
    for email, u in merged['per_user'].items():
        out_calls_for_user = [c for c in all_calls
                              if c.get('userId') and id_to_email(c['userId']) == email
                              and c.get('direction') == 'outgoing']
        if out_calls_for_user:
            total_sec = sum((c.get('duration') or 0) for c in out_calls_for_user)
            u['calls']['avg_duration_sec'] = int(round(total_sec / len(out_calls_for_user)))

    top = top_calls(all_calls, n=5)
    await asyncio.sleep(2)  # brief cooldown before transcript fetch
    transcripts = await fetch_transcripts_async(all_calls)

    # ── CM intro call detection → Railway ─────────────────────────────────
    KAL_PHONES = {pn['number'] for pn in PHONE_NUMBERS.values()}
    cm_calls_to_post = []
    for c in all_calls:
        if c.get('direction') != 'outgoing':
            continue
        if (c.get('duration') or 0) < 120:
            continue
        email = id_to_email(c.get('userId'))
        if not email or email not in CM_EMAILS:
            continue
        client_phones = [p for p in (c.get('participants') or []) if p not in KAL_PHONES]
        if not client_phones:
            continue
        cm_name = USER_TO_REP.get(email, email.split('@')[0].title())
        for phone in client_phones:
            cm_calls_to_post.append({'phone': phone, 'cm': cm_name, 'date': target, 'duration_sec': c.get('duration') or 0})

    if cm_calls_to_post:
        print(f'  > posting {len(cm_calls_to_post)} CM call records to Railway...', file=sys.stderr)
        for record in cm_calls_to_post:
            try:
                body = json.dumps(record).encode('utf-8')
                req = urllib.request.Request(
                    f'{RAILWAY_URL}/quo-calls', data=body,
                    headers={'Content-Type': 'application/json'}, method='POST')
                with urllib.request.urlopen(req, timeout=10) as r:
                    r.read()
            except Exception as e:
                print(f'  ! Railway post failed for {record["phone"]}: {e}', file=sys.stderr)
        print(f'  ✓ {len(cm_calls_to_post)} CM call records posted to Railway', file=sys.stderr)
    else:
        print('  > No CM intro calls detected today', file=sys.stderr)
    # ──────────────────────────────────────────────────────────────────────

    output = {
        'date': target,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'window_utc': {'since': since, 'until': until},
        'phone_numbers': PHONE_NUMBERS,
        'totals': merged['totals'],
        'per_line': [{'line': l['line'], 'totals': l['totals']} for l in line_aggregates],
        'per_user': merged['per_user'],
        'inbound_attribution': merged['inbound_attribution'],
        'top_calls': top,
        'transcripts': transcripts,
    }

    # Local write — only when the workspace folder exists (manual/debug Mac runs).
    # Atomic write — .tmp then rename, so a failed run never corrupts the output.
    if OUTPUT_DIR:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        out_path = os.path.join(OUTPUT_DIR, f'{target}.json')
        tmp_path = out_path + '.tmp'
        with open(tmp_path, 'w') as f:
            json.dump(output, f, indent=2, sort_keys=False)
        os.replace(tmp_path, out_path)
        print(f'\n✓ Wrote {out_path}', file=sys.stderr)

    # Encrypted publish to Railway — the path the Nain/Melanny briefs read from.
    publish_to_railway(target, output)

    elapsed = time.time() - t0
    print(f'  totals: {output["totals"]}', file=sys.stderr)
    print(f'  per_user: {len(output["per_user"])} users  transcripts: {len(transcripts)}  elapsed: {elapsed:.1f}s', file=sys.stderr)


def publish_to_railway(target, output):
    """Encrypt the full payload with Fernet and POST it to the authenticated
    /quo-data endpoint. The server stores ciphertext only — it never decrypts.
    No-op when secrets are absent (manual runs without env vars)."""
    if not (ENCRYPTION_KEY and SHARED_SECRET):
        print('  > Railway publish skipped (ENCRYPTION_KEY / SHARED_SECRET not set)', file=sys.stderr)
        return
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        print('  ! cryptography not installed — cannot encrypt; Railway publish skipped', file=sys.stderr)
        return
    plaintext = json.dumps(output, separators=(',', ':')).encode('utf-8')
    token = Fernet(ENCRYPTION_KEY.encode()).encrypt(plaintext).decode('ascii')
    body = json.dumps({'date': target, 'payload': token}).encode('utf-8')
    req = urllib.request.Request(
        f'{RAILWAY_URL}/quo-data', data=body, method='POST',
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + SHARED_SECRET})
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()
    print(f'  ✓ Published encrypted extract to Railway ({len(token)} bytes ciphertext)', file=sys.stderr)

def main(argv):
    global API_KEY, _executor, _sem
    # OpenPhone key: env var first (Railway), local .secrets file fallback (Mac).
    API_KEY = os.environ.get('OPENPHONE_API_KEY')
    if not API_KEY and KEY_PATH and os.path.isfile(KEY_PATH):
        API_KEY = open(KEY_PATH).read().strip()
    if not API_KEY:
        raise SystemExit("No OpenPhone API key. Set OPENPHONE_API_KEY or provide automation/.secrets/openphone.key")
    target = argv[1] if len(argv) > 1 else yesterday_pt()
    _executor = ThreadPoolExecutor(max_workers=ASYNC_SEM_LIMIT)
    asyncio.run(async_main(target))

if __name__ == '__main__':
    main(sys.argv)
