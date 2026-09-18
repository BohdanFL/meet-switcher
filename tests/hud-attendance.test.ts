import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD_ACTIONS_HTML, getHudSkeletonHtml } from '../src/content/ui/hud-template.ts';

test('HUD actions HTML has icon-only attendance button with title "Відвідуваність уроку"', () => {
  const actionsHtml = HUD_ACTIONS_HTML;
  assert.ok(actionsHtml.includes('attendance-btn'), 'Should include attendance-btn class');
  assert.ok(actionsHtml.includes('title="Відвідуваність уроку"'), 'Should have exact Ukrainian title tooltip');
  assert.ok(actionsHtml.includes('>📋</button>'), 'Should be icon-only button without text label');

  // Verify full skeleton contains actions
  const skeletonHtml = getHudSkeletonHtml();
  assert.ok(skeletonHtml.includes('attendance-btn'));
  assert.ok(skeletonHtml.includes('hud-header'));
});
