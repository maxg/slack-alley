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


Development
-----------

After creating Terraform configs, use `lambda/local` to run locally.

See:

 + https://github.com/dyhwong/piazza-api (*e.g.* `Content.js`)
 + https://github.com/hfaran/piazza-api (*e.g.* `rpc.py`, `nonce.py`)


Deployment
----------

In `setup`, create `terraform.tfvars` and `terraform.auto.tfvars` following the examples.

Complete SES domain verification.
