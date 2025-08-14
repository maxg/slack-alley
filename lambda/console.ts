import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

import * as on_email from './on-email.ts';

const args = parseArgs({
  options: {
    domain: { type: 'string' },
    course: { type: 'string' },
  },
  allowPositionals: true,
});

const { domain, course } = args.values;
const cids = args.positionals;

assert(domain, 'domain required');
assert(course, 'course required');
assert(cids.length, 'one or more ids required');

const config = await on_email.get_config(course);
assert(config);

const piazza = await on_email.get_piazza(course, `${course}@${domain}`, config);
assert(piazza);

for (const cid of cids) {
  console.log(cid);
  const { data: { result } } = await piazza.content(cid);
  assert(result);

  const attachments = await piazza.to_slack(result, config);
  console.log(...attachments);
}
