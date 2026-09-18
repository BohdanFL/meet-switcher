import test from 'node:test';
import assert from 'node:assert/strict';
import { CallTitleDetector } from '../src/content/attendance/title-detector.ts';

test('CallTitleDetector extracts title matching Google Meet user HTML snippet', () => {
  const detector = new CallTitleDetector();

  // Create mock DOM matching user provided snippet:
  // <div class="ND08le" jscontroller="CXNSjc">
  //   <div jsname="z7Oi7b" class="Cpvy4b NPmbie">
  //     <span class="uZ1Eue eQj9Ue">
  //       <div role="heading" aria-level="1" class="Qp8KI oFHBjb">
  //         <div class="uBRSj" tt-id="ucc-15">
  //           <button aria-label="Meeting details">
  //             <div jsname="NeC6gb" class="u6vdEc ouH3xe">УКР_Гейм_ЧТ_19:00</div>
  //           </button>
  //         </div>
  //       </div>
  //     </span>
  //   </div>
  // </div>
  const mockTitleEl = {
    textContent: 'УКР_Гейм_ЧТ_19:00',
    getAttribute: (k: string) => (k === 'jsname' ? 'NeC6gb' : null),
  };

  const mockRoot = {
    querySelector: (sel: string) => {
      if (sel.includes('NeC6gb') || sel.includes('u6vdEc') || sel.includes('heading')) {
        return mockTitleEl;
      }
      return null;
    },
  } as any;

  const title = detector.extractTitle(mockRoot);
  assert.equal(title, 'УКР_Гейм_ЧТ_19:00');
});

test('CallTitleDetector falls back to tooltip element if main title is not ready', () => {
  const detector = new CallTitleDetector();

  const mockTooltip = {
    textContent: '  УКР_Гейм_ЧТ_19:00  ',
  };

  const mockRoot = {
    querySelector: (sel: string) => {
      if (sel.includes('tooltip')) {
        return mockTooltip;
      }
      return null;
    },
  } as any;

  const title = detector.extractTitle(mockRoot);
  assert.equal(title, 'УКР_Гейм_ЧТ_19:00');
});

test('CallTitleDetector filters out generic UI button labels and empty strings', () => {
  const detector = new CallTitleDetector();

  const mockInvalid = {
    textContent: 'Meeting details',
  };
  const mockRoot = {
    querySelector: () => mockInvalid,
  } as any;

  // Generic meeting details string should be ignored
  const title = detector.extractTitle(mockRoot);
  assert.equal(title, null);
});
