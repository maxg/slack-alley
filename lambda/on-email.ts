import type * as Lambda from 'aws-lambda';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { WebClient } from '@slack/web-api';

import * as piazza from './piazza.ts';

const { DATA_TABLE: TableName } = process.env;

const db = new DynamoDB();

const configs = {};
const piazzas = {};
const slacks = {};

export const get_config = (course: string) => {
  const dbkey = { cid: { S: 'class' }, key: { S: course } };
  return configs[course] || db.getItem({ TableName, Key: dbkey }).then((data) => {
    if (data && data.Item) {
      return configs[course] = Promise.resolve(data.Item.val.M);
    }
    throw new Error('no such class');
  });
};

export const get_piazza = (course: string, recipient: string, config): Promise<piazza.Piazza> => {
  return piazzas[course] || (
    piazzas[course] = piazza.login(recipient, config.piazza_password.S, config.piazza_nid.S)
  );
};

export const get_slack = (course: string, config): WebClient => {
  return slacks[course] || (
    slacks[course] = new WebClient(config.slack_token.S)
  );
};

export const handler: Lambda.SESHandler = async (event, context) => {
  
  const notification = event.Records[0].ses;
  
  const recipient = notification.mail.commonHeaders.to[0];
  const course = recipient.split('@')[0];
  const cid_headers = notification.mail.headers.map(h => {
    return (h.name === 'References') && h.value.match(/(^<?)([a-z0-9]{12,16})((_\d+)?@piazza.com)/);
  }).filter(m => m);
  
  const found = cid_headers.length && cid_headers[0];
  if ( ! found) {
    console.error('no referenced id in email headers');
    return;
  }
  const updated_cid = found[2];
  
  const config = await get_config(course);
  const piazza = await get_piazza(course, recipient, config);
  const { data: { result: content } } = await piazza.content(updated_cid);
  // XXX errors
  
  const slack = get_slack(course, config);
  
  const dbkey = { cid: { S: content.id }, key: { S: 'ts' } };
  
  const [ data, attachments ] = await Promise.all([
    db.getItem({ TableName, Key: dbkey }),
    piazza.to_slack(content, config),
  ]);
  
  if (data && data.Item) {
    
    const res = await slack.chat.update({
      channel: config.slack_channel.S,
      ts: data.Item.val.S,
      attachments,
    });
    if ( ! res.ok) { throw new Error(res.error); }
    
  } else {
    
    const res = await slack.chat.postMessage({
      channel: config.slack_channel.S,
      username: 'piazza',
      attachments,
    });
    if ( ! res.ok) { throw new Error(res.error); }
    await db.updateItem({
      TableName,
      Key: dbkey,
      UpdateExpression: 'SET val = :val',
      ExpressionAttributeValues: { ':val': { S: res.ts } },
    });
    
  }
};
