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
    
    const network_get_users = (ids) => post(cookie, 'network.get_users', { ids, nid })
    
    return {
      content: (cid) => post(cookie, 'content.get', { nid, cid }),
      network_get_users,
      to_slack: (content) => to_slack(nid, network_get_users, content),
    };
  });
};

const to_slack = exports.to_slack = (nid, network_get_users, content) => {
  
  const student_answer = content.children.find(c => c.type === 's_answer');
  const instructor_answer = content.children.find(c => c.type === 'i_answer');
  const followups = content.children.filter(c => c.type === 'followup');
  
  const uids = new Set();
  [
    content.history,
    student_answer && student_answer.history,
    instructor_answer && instructor_answer.history,
    followups,
    ...followups.map((followup) => followup.children),
  ].forEach((arr) => arr && arr.forEach((change) => { uids.add(change.uid); }));
  
  return network_get_users([ ...uids ]).then(({ data }) => {
    const users = data.result || [];
    
    const attachments = [];
    // XXX TODO is it a question or a note
    if (content.history.length) {
      const question = content.history[content.history.length-1];
      const title = _excerpt(question.subject);
      const text = _excerpt(question.content);
      const authors = _authors(content.history, users);
      attachments.push({
        fallback: `@${content.nr}: ${title} (${authors})\n${text}`,
        pretext: `*<https://piazza.com/class/${nid}?cid=${content.nr}|@${content.nr}: ${title}>* (${authors})`,
        color: '#8dc63f', // XXX is the poster a student?
        text,
      });
    }
    if (student_answer && student_answer.history.length) {
      const answer = student_answer.history[student_answer.history.length-1];
      const text = _excerpt(answer.content);
      const authors = _authors(student_answer.history, users);
      attachments.push({
        fallback: `Student Answer (${authors}): ${text}`,
        pretext: `Student Answer (${authors})`,
        color: '#8dc63f',
        text,
      });
    }
    if (instructor_answer && instructor_answer.history.length) {
      const answer = instructor_answer.history[instructor_answer.history.length-1];
      const text = _excerpt(answer.content);
      const authors = _authors(instructor_answer.history, users);
      attachments.push({
        fallback: `Instructor Answer (${authors}): ${text}`,
        pretext: `Instructor Answer (${authors})`,
        color: '#faae40',
        text,
      });
    }
    followups.forEach((followup) => {
      const text = _excerpt(followup.subject);
      const authors = _authors([ followup, ...followup.children ].reverse(), users);
      attachments.push({
        fallback: `Discussion (${authors}): ${text}`,
        pretext: `Discussion (${authors})`,
        text,
      });
      followup.children.forEach((reply) => {
        const text = _excerpt(reply.subject);
        attachments.push({
          fallback: text,
          text,
        });
      });
    });
    
    return attachments;  
  });
};

const _excerpt = (html) => {
  return html2plaintext(html).replace(/(\s*\n)+/g,'\n').replace(/((\w+\W+){0,30})(.*)/s, (all, first, _, rest) => {
    const more = (rest.match(/\b/g) || []).length;
    return first + (more > 10 ? ` _...${more} words..._` : rest);
  });
};

const _authors = (arr, users) => arr.map(({ uid }) => uid).reverse().filter((uid, idx, arr) => {
  return arr.indexOf(uid) === idx;
}).map((uid) => users.find((user) => user.id === uid)).map((user) => {
  return user ? user.email.replace('@mit.edu', '') : 'unknown';
}).join(', ');
