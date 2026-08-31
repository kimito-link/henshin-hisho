import assert from 'node:assert/strict';
import { projectsRouteMatch } from '../src/projects/routes.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

test('projectsRouteMatch: 詳細', () => {
  assert.deepEqual(projectsRouteMatch('/projects/proj_abc123'), { projectId: 'proj_abc123', action: 'detail' });
});

test('projectsRouteMatch: channels', () => {
  assert.deepEqual(projectsRouteMatch('/projects/proj_abc123/channels'), { projectId: 'proj_abc123', action: 'channels' });
});

test('projectsRouteMatch: messages/manual', () => {
  assert.deepEqual(projectsRouteMatch('/projects/proj_abc123/messages/manual'), { projectId: 'proj_abc123', action: 'messages/manual' });
});

test('projectsRouteMatch: sync', () => {
  assert.deepEqual(projectsRouteMatch('/projects/proj_abc123/sync'), { projectId: 'proj_abc123', action: 'sync' });
});

test('projectsRouteMatch: assist', () => {
  assert.deepEqual(projectsRouteMatch('/projects/proj_abc123/assist'), { projectId: 'proj_abc123', action: 'assist' });
});

test('projectsRouteMatch: message-visibility（メッセージIDにアンダースコア含む）', () => {
  assert.deepEqual(
    projectsRouteMatch('/projects/proj_abc123/messages/msg_def456/visibility'),
    { projectId: 'proj_abc123', action: 'message-visibility', subId: 'msg_def456' }
  );
});

test('projectsRouteMatch: URLエンコードされたIDをデコードする', () => {
  const match = projectsRouteMatch('/projects/proj%20abc/channels');
  assert.equal(match.projectId, 'proj abc');
});

test('projectsRouteMatch: 該当しないパスはnull', () => {
  assert.equal(projectsRouteMatch('/projects'), null);
  assert.equal(projectsRouteMatch('/projects/'), null);
  assert.equal(projectsRouteMatch('/inbox'), null);
  assert.equal(projectsRouteMatch('/projects/abc/unknown-action'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
