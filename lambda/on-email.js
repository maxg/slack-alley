const { DynamoDB } = require('aws-sdk');
const { WebClient } = require('@slack/client');

const piazza = require('./piazza');

const { DATA_TABLE } = process.env;

const db = new DynamoDB({ params: { TableName: DATA_TABLE } });

const configs = {};
const piazzas = {};
const slacks = {};

const get_config = exports.get_config = (course) => {
  const dbkey = { cid: { S: 'class' }, key: { S: course } };
  return configs[course] || db.getItem({ Key: dbkey }).promise().then((data) => {
    if (data && data.Item) {
      return configs[course] = Promise.resolve(data.Item.val.M);
    }
    throw new Error('no such class');
  });
};

const get_piazza = exports.get_piazza = (course, recipient, config) => {
  return piazzas[course] || (
    piazzas[course] = piazza.login(recipient, config.piazza_password.S, config.piazza_nid.S)
  );
};

const get_slack = exports.get_slack = (course, config) => {
  return slacks[course] || (
    slacks[course] = new WebClient(config.slack_token.S)
  );
};

const lambda_handler = exports.handler = (event, context, callback) => {
  
  const notification = event.Records[0].ses;
  
  const recipient = notification.mail.commonHeaders.to;
  const course = recipient.split('@')[0];
  const messageID = notification.mail.commonHeaders.messageId;
  
  const found = messageID.match(/(^<?)([a-z0-9]{12,14})((_\d+)?@)/);
  if ( ! found) { return callback(); }
  const updated_cid = found[2];
  
  get_config(course).then((config) => {
    get_piazza(course, recipient, config).then((piazza) => {
      piazza.content(updated_cid).then(({ data }) => {
        // XXX errors
        const content = data.result;
        
        const slack = get_slack(course, config);
        
        const dbkey = { cid: { S: content.id }, key: { S: 'ts' } };
        db.getItem({ Key: dbkey }).promise().then((data) => {
          
          const attachments = piazza.to_slack(content, config);
          
          if (data && data.Item) {
            
            attachments.then((attachments) => slack.chat.update({
              channel: config.slack_channel.S,
              ts: data.Item.val.S,
              attachments,
            })).then((res) => {
              if ( ! res.ok) { throw new Error(res.error); }
              callback();
            });
            
          } else {
            
            attachments.then((attachments) => slack.chat.postMessage({
              channel: config.slack_channel.S,
              username: 'piazza',
              attachments,
            })).then((res) => {
              if ( ! res.ok) { throw new Error(res.error); }
              db.updateItem({
                Key: dbkey,
                UpdateExpression: 'SET val = :val',
                ExpressionAttributeValues: { ':val': { S: res.ts } },
              }, (err) => {
                if (err) { throw err; }
                callback();
              });
            });
            
          }
        });
      });
    });
  });
};
