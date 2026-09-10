import { ScreenDetector } from './detector';

const MOCK_STUDENTS = [
  { name: 'Олександр Коваль', lang: 'JavaScript', task: 'function calculateSum(a, b) {\n  return a + b;\n}' },
  { name: 'Марія Шевченко', lang: 'Python', task: 'def fetch_user_data(user_id):\n  return db.query(user_id)' },
  { name: 'Іван Бондар', lang: 'HTML/CSS', task: '<div class="student-card">\n  <h2>Task #3 Active</h2>\n</div>' },
  { name: 'Анна Ткач', lang: 'TypeScript', task: 'interface Props {\n  title: string;\n  count: number;\n}' },
  { name: 'Дмитро Кравчук', lang: 'React', task: 'const [count, setCount] = useState(0);\nuseEffect(() => {}, []);' },
  { name: 'Олена Мороз', lang: 'C++', task: '#include <iostream>\nint main() {\n  std::cout << "OK";\n}' },
  { name: 'Максим Бойко', lang: 'SQL', task: 'SELECT students.name, grades.score\nFROM students JOIN grades;' },
  { name: 'Юлія Мельник', lang: 'Algorithm', task: 'while (left <= right) {\n  mid = (left + right) // 2;\n}' },
  { name: 'Артем Литвин', lang: 'Debug', task: 'console.log("Bug fixed in line 42");\n// Verification complete' },
];

export class MockGenerator {
  private detector: ScreenDetector;
  private isRunning = false;
  private containerEl: HTMLElement | null = null;
  private animationTimers: number[] = [];

  constructor(detector: ScreenDetector) {
    this.detector = detector;
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public toggle(): boolean {
    if (this.isRunning) {
      this.disable();
    } else {
      this.enable();
    }
    return this.isRunning;
  }

  public enable(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[MeetSwitcher] 🧪 Enabling Demo Simulation Mode with 9 student screens...');

    this.containerEl = document.createElement('div');
    this.containerEl.id = 'meet-switcher-mock-container';
    this.containerEl.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      width: 640px;
      height: 360px;
      opacity: 0.01;
      pointer-events: auto;
      z-index: -1;
    `;

    document.body.appendChild(this.containerEl);

    MOCK_STUDENTS.forEach((student, idx) => {
      const studentIndex = idx + 1;
      const tile = document.createElement('div');
      tile.className = 'oZRSLe mock-student-tile';
      tile.style.width = '640px';
      tile.style.height = '360px';
      tile.setAttribute('data-participant-id', `mock-student-${studentIndex}`);
      tile.setAttribute('data-requested-participant-id', `mock-student-${studentIndex}`);

      // Synthetic Animated Canvas
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      let frame = 0;
      const timer = window.setInterval(() => {
        if (!ctx) return;
        frame++;

        // VS Code dark theme
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, 640, 360);

        // Header bar
        ctx.fillStyle = '#252526';
        ctx.fillRect(0, 0, 640, 42);
        ctx.fillStyle = '#61afef';
        ctx.font = 'bold 18px monospace';
        ctx.fillText(`📄 [${studentIndex}] ${student.name} • ${student.lang}`, 20, 27);

        // Code editor lines
        ctx.fillStyle = '#abb2bf';
        ctx.font = '16px monospace';
        const lines = student.task.split('\n');
        lines.forEach((line, lineIdx) => {
          ctx.fillStyle = '#5c6370';
          ctx.fillText(`${lineIdx + 1}`, 15, 80 + lineIdx * 30);
          ctx.fillStyle = lineIdx === 0 ? '#e06c75' : '#98c379';
          ctx.fillText(line, 45, 80 + lineIdx * 30);
        });

        // Status bar
        ctx.fillStyle = '#007acc';
        ctx.fillRect(0, 325, 640, 35);
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px monospace';
        ctx.fillText(`⚡ Live Screen • Progress: ${(frame * 2) % 100}% • UTF-8`, 20, 348);
      }, 100);

      this.animationTimers.push(timer);

      // Create live Video tag from Canvas
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = (canvas as any).captureStream(20);

      const controlsWrap = document.createElement('div');
      controlsWrap.className = 'mock-controls';

      const updateControls = (isPinned: boolean) => {
        controlsWrap.innerHTML = `
          <div style="display:none;">${isPinned ? 'keep_off' : 'keep_outline'}</div>
          ${
            isPinned
              ? `<button class="mock-unpin-btn" aria-label="Unpin ${student.name}'s presentation from your main screen">Unpin</button>`
              : `<button class="mock-pin-btn" aria-label="Pin ${student.name}'s presentation to your main screen">Pin</button>`
          }
          <button aria-label="More options for ${student.name}">More</button>
        `;

        const pinBtn = controlsWrap.querySelector<HTMLButtonElement>('.mock-pin-btn');
        if (pinBtn) {
          pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Unpin all other mock tiles
            this.containerEl?.querySelectorAll<HTMLElement>('.mock-student-tile').forEach((t) => {
              if (t !== tile && (t as any).__setMockPinned) {
                (t as any).__setMockPinned(false);
              }
            });
            updateControls(true);
            setTimeout(() => this.detector.scan(), 60);
          });
        }

        const unpinBtn = controlsWrap.querySelector<HTMLButtonElement>('.mock-unpin-btn');
        if (unpinBtn) {
          unpinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateControls(false);
            setTimeout(() => this.detector.scan(), 60);
          });
        }
      };

      (tile as any).__setMockPinned = updateControls;
      updateControls(false);

      tile.appendChild(controlsWrap);
      tile.appendChild(video);
      this.containerEl!.appendChild(tile);
    });

    // Notify detector of new simulated screen shares
    setTimeout(() => this.detector.scan(), 50);
  }

  public disable(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log('[MeetSwitcher] 🧪 Disabling Demo Simulation Mode...');

    for (const timer of this.animationTimers) {
      clearInterval(timer);
    }
    this.animationTimers = [];

    if (this.containerEl && this.containerEl.parentElement) {
      this.containerEl.parentElement.removeChild(this.containerEl);
      this.containerEl = null;
    }

    // Rescan detector to clear list
    setTimeout(() => this.detector.scan(), 50);
  }
}
