const https = require('https');

const html2plaintext = require('html2plaintext');

const post = (cookie, method, params) => new Promise((resolve, reject) => {
  
  const nonce = (+new Date()).toString(36) + 'abcd';
  const csrf = cookie.filter(c => c.startsWith('session_id=')).map(c => c.split('=')[1]).join('');
  
  const req = https.request({
    hostname: 'piazza.com',
    path: `/logic/api?method=${method}&aid=${nonce}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'csrf-token': csrf },
  }, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`${method} response code ${res.statusCode}`));
    } else {
      const body = [];
      res.on('data', (chunk) => body.push(chunk));
      res.on('end', () => {
        const data = JSON.parse(body.join(''));
        if (data.error) {
          reject(new Error(`${method} response error ${data.error}`));
        } else {
          resolve({ headers: res.headers, data });
        }
      });
    }
  });
  req.on('error', (err) => reject(err));
  req.end(JSON.stringify({ method, params }));
});

const login = exports.login = (email, password, nid) => {
  return post([], 'user.login', { email, pass: password }).then(({ headers, data }) => {
    const cookie = headers['set-cookie'].map((set) => set.split(';')[0]);
    return {
      content: (cid) => post(cookie, 'content.get', { nid, cid }),
      to_slack: (content) => to_slack(nid, content),
    };
  });
};

const to_slack = exports.to_slack = function(nid, content) {
  const attachments = [];
  // XXX TODO is it a question or a note
  if (content.history.length) {
    const question = content.history[content.history.length-1];
    const title = html2plaintext(question.subject);
    const text = html2plaintext(question.content);
    attachments.push({
      fallback: `Piazza @${content.nr}: ${title}\n${text}`,
      pretext: `<https://piazza.com/class/${nid}?cid=${content.nr}|Piazza @${content.nr}>`,
      color: '#8dc63f', // XXX is the poster a student?
      // author_name: '???', // XXX
      title,
      title_link: `https://piazza.com/class/${nid}?cid=${content.nr}`,
      text,
      // ts: ???,
    });
  }
  const student_answer = content.children.find(c => c.type === 's_answer');
  if (student_answer && student_answer.history.length) {
    const answer = student_answer.history[student_answer.history.length-1];
    const text = html2plaintext(answer.content);
    attachments.push({
      fallback: `Student Answer: ${text}`,
      pretext: 'Student Answer',
      color: '#8dc63f',
      // author_name: '???', // XXX
      text,
      // ts: ???,
    });
  }
  const instructor_answer = content.children.find(c => c.type === 'i_answer');
  if (instructor_answer && instructor_answer.history.length) {
    const answer = instructor_answer.history[instructor_answer.history.length-1];
    const text = html2plaintext(answer.content);
    attachments.push({
      fallback: `Instructor Answer: ${text}`,
      pretext: 'Instructor Answer',
      color: '#faae40',
      // author_name: '???', // XXX
      text,
      // ts: ???,
    });
  }
  content.children.filter(c => c.type === 'followup').forEach((followup) => {
    const text = html2plaintext(followup.subject);
    attachments.push({
      fallback: `${followup.no_answer ? 'Unresolved' : 'Resolved'} Discussion: ${text}`,
      pretext: `${followup.no_answer ? 'Unresolved' : 'Resolved'} Discussion`,
      // XXX color: ???,
      // author_name: '???',
      text,
      // ts: ???,
    });
    followup.children.forEach((reply) => {
      const text = html2plaintext(reply.subject);
      attachments.push({
        fallback: text,
        // XXX color: ???,
        // author_name: '???',
        text,
        // ts: ???,
      });
    });
  });
  return attachments;
};
