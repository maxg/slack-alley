const https = require('https');

const { DynamoDB } = require('aws-sdk');
const html2plaintext = require('html2plaintext');

const { DATA_TABLE } = process.env;

const db = new DynamoDB({ params: { TableName: DATA_TABLE } });

const get_csrf = () => new Promise((resolve, reject) => {
  const req = https.request({
    hostname: 'piazza.com',
    path: '/main/csrf_token',
  }, (res) => {
    const body = [];
    res.on('data', (chunk) => body.push(chunk));
    res.on('end', () => {
      const match = body.join('').match(/CSRF_TOKEN="(.+)"/);
      if (match) {
        resolve(match[1]);
      } else {
        reject(new Error('failed to get CSRF token'));
      }
    });
  });
  req.on('error', (err) => reject(err));
  req.end();
});

const post_login = (email, password, csrf_token) => new Promise((resolve, reject) => {
  const req = https.request({
    hostname: 'piazza.com',
    path: '/class',
    method: 'POST',
    headers: { cookie: `session_id=${csrf_token}` },
  }, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`login response code ${res.statusCode}`));
    } else {
      resolve({ headers: res.headers });
    }
  });
  req.on('error', (err) => reject(err));
  req.end(`email=${email}&password=${password}&csrf_token=${csrf_token}`);
});

const api_post = (cookie, method, params) => new Promise((resolve, reject) => {
  
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
  return get_csrf().then(csrf_token => post_login(email, password, csrf_token)).then(({ headers }) => {
    const cookie = headers['set-cookie'].map((set) => set.split(';')[0]);
    
    const post_with_cookie = (method, params) => api_post(cookie, method, params);
    
    return {
      content: (cid) => api_post(cookie, 'content.get', { nid, cid }),
      to_slack: (content, config) => to_slack(nid, post_with_cookie, content, config),
    };
  });
};

const network_get_authors = (nid, post_with_cookie, ids) => {
  return post_with_cookie('network.get_users', { ids, nid }).then(({ data }) => {
    const users = data.result || [];
    
    const dbkeys = users.map(user => ({ cid: { S: 'email' }, key: { S: user.email } }));
    return db.batchGetItem({
      RequestItems: { [DATA_TABLE]: { Keys: dbkeys } }
    }).promise().then((data) => {
      const rewrites = {};
      data.Responses[DATA_TABLE].forEach(({ key: { S: email }, val: { S: username } }) => {
        rewrites[email] = username;
      });
      const users_map = {};
      users.forEach(({ id, email, name, role }) => {
        users_map[id] = { id, email: rewrites[email] || email, name, role };
      });
      return users_map;
    });
  });
};

const to_slack = exports.to_slack = (nid, post_with_cookie, content, config) => {
  
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
  
  return network_get_authors(nid, post_with_cookie, [ ...uids ]).then((users) => {
    const attachments = [];
    // XXX TODO is it a question or a note
    if (content.history.length) {
      const private = content.status === 'private';
      const title = `@${content.nr}: ${_excerpt(content.history[0].subject)}`;
      const text = _excerpt(content.history[0].content);
      const authors = _authors(content.history, users, config.user_info.S);
      const student = users[content.history[0].uid].role === 'student';
      attachments.push({
        fallback: `${title} ${private ? '[private] ' : ''}(${authors.map(a => a.username).join(', ')})\n${text}`,
        pretext: `*<https://piazza.com/class/${nid}?cid=${content.nr}|${_escape(title)}>* ${private ? 'ᵖʳⁱᵛᵃᵗᵉ ' : ''}(${authors.map(a => a.link).join(', ')})`,
        color: student ? '#8dc63f' : '#faae40',
        text: _escape(text),
      });
    }
    if (student_answer && student_answer.history.length) {
      const text = _excerpt(student_answer.history[0].content);
      const authors = _authors(student_answer.history, users, config.user_info.S);
      attachments.push({
        fallback: `Student Answer (${authors.map(a => a.username).join(', ')}): ${text}`,
        pretext: `Student Answer (${authors.map(a => a.link).join(', ')})`,
        color: '#8dc63f',
        text: _escape(text),
      });
    }
    if (instructor_answer && instructor_answer.history.length) {
      const text = _excerpt(instructor_answer.history[0].content);
      const authors = _authors(instructor_answer.history, users, config.user_info.S);
      attachments.push({
        fallback: `Instructor Answer (${authors.map(a => a.username).join(', ')}): ${text}`,
        pretext: `Instructor Answer (${authors.map(a => a.link).join(', ')})`,
        color: '#faae40',
        text: _escape(text),
      });
    }
    followups.forEach((followup) => {
      const text = _excerpt(followup.subject);
      const authors = _authors([ followup, ...followup.children ].reverse(), users, config.user_info.S);
      attachments.push({
        fallback: `Discussion (${authors.map(a => a.username).join(', ')}): ${text}`,
        pretext: `Discussion (${authors.map(a => a.link).join(', ')})`,
        text: _escape(text),
      });
      followup.children.forEach((reply) => {
        const text = _excerpt(reply.subject);
        attachments.push({
          fallback: text,
          text: _escape(text),
        });
      });
    });
    
    return attachments;  
  });
};

const _excerpt = (html) => {
  return html2plaintext(html).replace(/(\s*\n)+/g, '\n').replace(/(\W*(\w+\W+){0,30})(.*)/s, (all, first, _, rest) => {
    const more = (rest.match(/\w\b/g) || []).length;
    return first + (more > 10 ? ` _...${more} words..._` : rest);
  });
};

const _escape = (markup) => {
  return markup.replace(/[&<>]/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char];
  });
};

const _authors = (arr, users, user_info) => arr.map(({ uid }) => {
  return uid;
}).reverse().filter((uid, idx, arr) => {
  return arr.indexOf(uid) === idx;
}).map((uid) => users[uid]).map((user) => {
  if ( ! user) {
    return { username: 'unknown', link: '*unknown*' };
  }
  const username = user.email.replace('@mit.edu', '');
  if (/\W/.test(username) || user.role != 'student' || ! user_info) {
    return { username, link: username };
  }
  return { username, link: `<${user_info}${username}|${username}>` };
});
