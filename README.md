Slack Alley
===========

Piazza &rarr; Slack staff backchannel


Setup
-----

Create a Piazza account for `<course-number>@<slack-alley-domain>`.
Add that user as an instructor in the class.
Set their email settings for the class to: real time + real time + follow everything.

Create a DynamoDB item:

    {
      "cid": "class",
      "key": <course-number>,
      "val": {
        "piazza_nid": <piazza-network-id>,
        "piazza_password": <piazza-account-password>,
        "slack_channel": <slack-channel-id>,
        "slack_token": <slack-app-token>,
        "user_domain": <student-email-domain>,
        "user_info": <prefix-for-user-info-web-page>
      }
    }

For users with non-`user_domain` email addresses on Piazza, create DynamoDB items:

    {
      "cid": "email",
      "key": <email-address-on-piazza>,
      "val": <username>
    }


Development
-----------

To run locally:

    node console.ts --domain <slack-alley-domain> --course <course-number> <piazza-message-cid>

See:

 + https://github.com/dyhwong/piazza-api (*e.g.* `Content.js`)
 + https://github.com/hfaran/piazza-api (*e.g.* `rpc.py`, `nonce.py`)


Deployment
----------

In `setup`, create `terraform.tfvars` and `terraform.auto.tfvars` following the examples.

In the dev container: in `lambda` run `npm install`, and in `setup` run `pack` to generate the Lambda deployment package.

After Terraform, complete SES domain verification.

To test `on-email` in the Lambda console, create test events:

    {
      "Records": [ {
        "ses": { "mail": {
          "commonHeaders": { "to": [ <course-number>"@"<slack-alley-domain> ] },
          "headers": [ { "name": "References", "value": "<"<piazza-message-cid>"@piazza.com>" } ]
        } }
      } ]
    }

Or to send test emails in the SES console, use any *from-address*, appropriate *custom recipient*, and *raw* message:

    To: ...@...
    References: <...@piazza.com>
    Subject: notification
    MIME-Version: 1.0
    Content-Type: text/plain
    
    test
