const { DynamoDB } = require('aws-sdk');
const { WebClient } = require('@slack/client');

const { DATA_TABLE, EMAIL, PIAZZA_PASSWORD, PIAZZA_CLASS, SLACK_CHANNEL } = process.env;

const db = new DynamoDB({ params: { TableName: DATA_TABLE } });
const slack = new WebClient(process.env.SLACK_TOKEN);
const piazza = require('./piazza').login(EMAIL, PIAZZA_PASSWORD, PIAZZA_CLASS);

const lambda_handler = exports.handler = (event, context, callback) => {
  
  const notification = event.Records[0].ses;
  
  const messageID = notification.mail.commonHeaders.messageId;
  
  const found = messageID.match(/(^<?)([a-z0-9]{12,14})((_\d+)?@)/);
  if ( ! found) { return callback(); }
  const updated_cid = found[2];
  
  piazza.then((piazza) => {
    piazza.content(updated_cid).then(({ data }) => {
      // XXX errors
      const content = data.result;
      
      const dbkey = { cid: { S: content.id }, key: { S: 'ts' } };
      db.getItem({ Key: dbkey }, (err, data) => {
        if (err) { throw err; }
        
        const attachments = piazza.to_slack(content);
        
        if (data && data.Item) {
          
          attachments.then((attachments) => slack.chat.update({
            channel: SLACK_CHANNEL,
            ts: data.Item.val.S,
            attachments,
          })).then((res) => {
            if ( ! res.ok) { throw new Error(res.error); }
            callback();
          });
          
        } else {
          
          attachments.then((attachments) => slack.chat.postMessage({
            channel: SLACK_CHANNEL,
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
};
