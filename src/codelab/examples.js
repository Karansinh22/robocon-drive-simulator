// Starter code the students can load. All values are -255..255 and inputs are -100..100.

const SKID_BASIC = `# Skid steer - basic mixing
# x: stick right (+) / left (-)     y: stick forward (+) / back (-)     both -100..100
# Return the speed of the LEFT side and the RIGHT side, each -255..255.

def mix(x, y):
    left = y + x
    right = y - x
    return round(left * 2.55), round(right * 2.55)
`;

const SKID_FULL = `# Skid steer - full: deadzone + scaling that keeps the direction
PARAMS = {"deadzone": 8}


def mix(x, y):
    if abs(x) < PARAMS["deadzone"]: x = 0
    if abs(y) < PARAMS["deadzone"]: y = 0
    left = y + x
    right = y - x
    biggest = max(abs(left), abs(right), 100)
    left = left * 100 / biggest
    right = right * 100 / biggest
    return round(left * 2.55), round(right * 2.55)
`;

const MECANUM_FULL = `# Mecanum - full mixing
# x: right (+)   y: forward (+)   r: rotate CLOCKWISE (+)    all -100..100
# Return [fl, fr, rl, rr], each -255..255.

def mix4(x, y, r):
    fl = y + x + r
    fr = y - x - r
    rl = y - x + r
    rr = y + x - r
    biggest = max(abs(fl), abs(fr), abs(rl), abs(rr))
    biggest = max(biggest, 100)
    out = []
    for v in (fl, fr, rl, rr):
        out.append(round(v * 255 / biggest))
    return out
`;

const MECANUM_TUNING = `# Mecanum - tuning: deadzone, max speed, expo curve and a ramp
# Move the sliders in the Tuning tab - no need to press Run again.
PARAMS = {"deadzone": 8, "max_speed": 1.0, "expo": 0.3, "ramp": 40}

last = [0, 0, 0, 0]          # outputs of the previous call (a module-level variable keeps its value)


def shape(v):
    # ignore tiny stick movements, then blend in a curve for fine control near the centre
    if abs(v) < PARAMS["deadzone"]:
        return 0
    e = PARAMS["expo"]
    return (1 - e) * v + e * v ** 3 / 100 ** 2


def mix4(x, y, r):
    global last
    x, y, r = shape(x), shape(y), shape(r)
    fl = y + x + r
    fr = y - x - r
    rl = y - x + r
    rr = y + x - r
    biggest = max(abs(fl), abs(fr), abs(rl), abs(rr), 100)
    target = [v * 255 / biggest * PARAMS["max_speed"] for v in (fl, fr, rl, rr)]

    out = []
    for i in range(4):
        change = target[i] - last[i]
        change = max(-PARAMS["ramp"], min(PARAMS["ramp"], change))   # limit the change per call
        out.append(last[i] + change)
    last = out
    return [round(v) for v in out]
`;

const BUG_SKID_SWAPPED = `# FIND THE BUG: push the stick RIGHT. The robot turns the wrong way!
PARAMS = {"deadzone": 8}


def mix(x, y):
    if abs(x) < PARAMS["deadzone"]: x = 0
    if abs(y) < PARAMS["deadzone"]: y = 0
    left = y - x
    right = y + x
    biggest = max(abs(left), abs(right), 100)
    left = left * 100 / biggest
    right = right * 100 / biggest
    return round(left * 2.55), round(right * 2.55)
`;

const BUG_SKID_NO_SCALING = `# FIND THE BUG: push the stick diagonally. Watch the yellow warning and the direction.
PARAMS = {"deadzone": 8}


def mix(x, y):
    if abs(x) < PARAMS["deadzone"]: x = 0
    if abs(y) < PARAMS["deadzone"]: y = 0
    left = y + x
    right = y - x
    return round(left * 2.55), round(right * 2.55)
`;

const BUG_SKID_NO_DEADZONE = `# FIND THE BUG: use a gamepad and let go of the stick. The robot creeps along!
# (A real stick never rests at exactly 0. Try the Gamepad input, or the "Gentle stick" test script.)
PARAMS = {"deadzone": 8}


def mix(x, y):
    left = y + x
    right = y - x
    biggest = max(abs(left), abs(right), 100)
    left = left * 100 / biggest
    right = right * 100 / biggest
    return round(left * 2.55), round(right * 2.55)
`;

const BUG_MECANUM_DIAGONAL = `# FIND THE BUG: push the stick RIGHT. The robot should slide right, but it goes diagonal!

def mix4(x, y, r):
    fl = y + x + r
    fr = y - r
    rl = y + r
    rr = y + x - r
    biggest = max(abs(fl), abs(fr), abs(rl), abs(rr), 100)
    out = []
    for v in (fl, fr, rl, rr):
        out.append(round(v * 255 / biggest))
    return out
`;


/* ---------------- C++ versions ---------------- */
// In C++ the outputs are passed back through reference parameters (the & before the name).

const CPP_SKID_BASIC = `// Skid steer - basic mixing (C++)
// x: stick right (+) / left (-)     y: stick forward (+) / back (-)     both -100..100
// Set the speed of the LEFT side and the RIGHT side, each -255..255.
// The & means "reference": when you change left, the caller sees the new value.

void mix(int x, int y, int &left, int &right) {
    left  = round((y + x) * 2.55);
    right = round((y - x) * 2.55);
}
`;

const CPP_SKID_FULL = `// Skid steer - full: deadzone + scaling that keeps the direction (C++)
#define PARAM            // PARAM marks a number that the Tuning tab can change

PARAM int deadzone = 8;

void mix(int x, int y, int &left, int &right) {
    if (abs(x) < deadzone) x = 0;
    if (abs(y) < deadzone) y = 0;
    float l = y + x;
    float r = y - x;
    float biggest = max(max(abs(l), abs(r)), 100.0f);
    l = l * 100 / biggest;
    r = r * 100 / biggest;
    left = round(l * 2.55);
    right = round(r * 2.55);
}
`;

const CPP_MECANUM_FULL = `// Mecanum - full mixing (C++)
// x: right (+)   y: forward (+)   r: rotate CLOCKWISE (+)    all -100..100
// Outputs fl, fr, rl, rr are references, each -255..255.
// Careful: int / int throws the decimals away. Multiply first, divide last!

void mix4(int x, int y, int r, int &fl, int &fr, int &rl, int &rr) {
    int a = y + x + r;
    int b = y - x - r;
    int c = y - x + r;
    int d = y + x - r;
    int biggest = max(max(abs(a), abs(b)), max(abs(c), abs(d)));
    biggest = max(biggest, 100);
    fl = a * 255 / biggest;
    fr = b * 255 / biggest;
    rl = c * 255 / biggest;
    rr = d * 255 / biggest;
}
`;

const CPP_MECANUM_TUNING = `// Mecanum - tuning: deadzone, max speed, expo curve and a ramp (C++)
// Move the sliders in the Tuning tab - no need to press Run again.
#define PARAM

PARAM int   deadzone  = 8;
PARAM float max_speed = 1.0;
PARAM float expo      = 0.3;
PARAM int   ramp      = 40;

float last[4] = {0, 0, 0, 0};    // outputs of the previous call (a global keeps its value)

float shape(float v) {
    // ignore tiny stick movements, then blend in a curve for fine control near the centre
    if (abs(v) < deadzone) return 0;
    return (1 - expo) * v + expo * v * v * v / (100.0 * 100.0);
}

void mix4(int x, int y, int r, int &fl, int &fr, int &rl, int &rr) {
    float sx = shape(x), sy = shape(y), sr = shape(r);
    float v[4] = { sy + sx + sr, sy - sx - sr, sy - sx + sr, sy + sx - sr };
    float biggest = max(max(abs(v[0]), abs(v[1])), max(abs(v[2]), abs(v[3])));
    biggest = max(biggest, 100.0f);

    for (int i = 0; i < 4; i++) {
        float target = v[i] * 255 / biggest * max_speed;
        float change = constrain(target - last[i], -ramp, ramp);   // limit the change per call
        last[i] = last[i] + change;
    }
    fl = round(last[0]);  fr = round(last[1]);
    rl = round(last[2]);  rr = round(last[3]);
}
`;

const CPP_BUG_SKID_SWAPPED = `// FIND THE BUG: push the stick RIGHT. The robot turns the wrong way!
#define PARAM

PARAM int deadzone = 8;

void mix(int x, int y, int &left, int &right) {
    if (abs(x) < deadzone) x = 0;
    if (abs(y) < deadzone) y = 0;
    float l = y - x;
    float r = y + x;
    float biggest = max(max(abs(l), abs(r)), 100.0f);
    left = round(l * 100 / biggest * 2.55);
    right = round(r * 100 / biggest * 2.55);
}
`;

const CPP_BUG_SKID_NO_SCALING = `// FIND THE BUG: push the stick diagonally. Watch the yellow warning and the direction.
#define PARAM

PARAM int deadzone = 8;

void mix(int x, int y, int &left, int &right) {
    if (abs(x) < deadzone) x = 0;
    if (abs(y) < deadzone) y = 0;
    left = round((y + x) * 2.55);
    right = round((y - x) * 2.55);
}
`;

const CPP_BUG_SKID_NO_DEADZONE = `// FIND THE BUG: use a gamepad and let go of the stick. The robot creeps along!
// (A real stick never rests at exactly 0. Try the Gamepad input, or the "Gentle stick" test script.)
#define PARAM

PARAM int deadzone = 8;

void mix(int x, int y, int &left, int &right) {
    float l = y + x;
    float r = y - x;
    float biggest = max(max(abs(l), abs(r)), 100.0f);
    left = round(l * 100 / biggest * 2.55);
    right = round(r * 100 / biggest * 2.55);
}
`;

const CPP_BUG_MECANUM_DIAGONAL = `// FIND THE BUG: push the stick RIGHT. The robot should slide right, but it goes diagonal!

void mix4(int x, int y, int r, int &fl, int &fr, int &rl, int &rr) {
    int a = y + x + r;
    int b = y - r;
    int c = y + r;
    int d = y + x - r;
    int biggest = max(max(abs(a), abs(b)), max(abs(c), abs(d)));
    biggest = max(biggest, 100);
    fl = a * 255 / biggest;
    fr = b * 255 / biggest;
    rl = c * 255 / biggest;
    rr = d * 255 / biggest;
}
`;

const CPP_ANSWERS = {
  swapped: 'l must be y + x and r must be y - x. Turning right (clockwise) needs the left side forward and the right side backward.',
  scaling: 'Use floats l and r, find "biggest = max(max(abs(l), abs(r)), 100.0f)" and compute l * 100 / biggest before multiplying by 2.55. Scaling by the biggest value keeps the direction.',
  deadzone: 'Add these two lines at the top of mix(): "if (abs(x) < deadzone) x = 0;" and the same for y.',
  diagonal: 'b must be y - x - r and c must be y - x + r. Without the x term only FL and RR drive while sliding, so the robot moves diagonally.',
};

const PYTHON_EXAMPLES = [
  { id: 'skid-basic', drive: 'skid', title: 'Skid steer — basic', code: SKID_BASIC },
  { id: 'skid-full', drive: 'skid', title: 'Skid steer — full', code: SKID_FULL },
  { id: 'mecanum-full', drive: 'mecanum', title: 'Mecanum — full', code: MECANUM_FULL },
  { id: 'mecanum-tuning', drive: 'mecanum', title: 'Mecanum — tuning example', code: MECANUM_TUNING },
  {
    id: 'bug-skid-swapped', drive: 'skid', title: 'Find the bug: wrong way', code: BUG_SKID_SWAPPED, bug: true,
    task: 'Push the stick right. The robot should turn clockwise (right) but it turns the other way.',
    hint: 'To turn right, which side must go forward and which must go backward? Compare left and right with the basic example.',
    answer: 'left must be y + x and right must be y - x. Turning right (clockwise) needs the left side forward and the right side backward.',
  },
  {
    id: 'bug-skid-scaling', drive: 'skid', title: 'Find the bug: no scaling', code: BUG_SKID_NO_SCALING, bug: true,
    task: 'Push the stick forward-right. The values go far past 255 and get clamped, so the robot does not curve as it should.',
    hint: 'y + x can be up to 200. What did the full example do with the biggest value before multiplying by 2.55?',
    answer: 'Add "biggest = max(abs(left), abs(right), 100)" and divide: left = left * 100 / biggest (same for right). Scaling by the biggest value keeps the direction.',
  },
  {
    id: 'bug-skid-deadzone', drive: 'skid', title: 'Find the bug: no deadzone', code: BUG_SKID_NO_DEADZONE, bug: true,
    task: 'A gamepad stick never rests at exactly 0, so the robot creeps when you let go. Use the "Gentle stick" test script to see it.',
    hint: 'PARAMS has a deadzone, but is it used anywhere in mix()?',
    answer: 'Add these two lines at the top of mix(): "if abs(x) < PARAMS[\\"deadzone\\"]: x = 0" and the same for y.',
  },
  {
    id: 'bug-mecanum-diagonal', drive: 'mecanum', title: 'Find the bug: slides diagonally', code: BUG_MECANUM_DIAGONAL, bug: true,
    task: 'Push the stick right. A mecanum robot should slide straight right, but this one goes diagonally.',
    hint: 'When you slide right, all four wheels must work. Look at FR and RL: do they use x at all?',
    answer: 'fr must be y - x - r and rl must be y - x + r. Without the x term only FL and RR drive while sliding, so the robot moves diagonally.',
  },
];

const withLang = (list, lang) => list.map((e) => ({ lang, ...e }));

const CPP_EXAMPLES = [
  { id: 'cpp-skid-basic', drive: 'skid', title: 'Skid steer — basic', code: CPP_SKID_BASIC },
  { id: 'cpp-skid-full', drive: 'skid', title: 'Skid steer — full', code: CPP_SKID_FULL },
  { id: 'cpp-mecanum-full', drive: 'mecanum', title: 'Mecanum — full', code: CPP_MECANUM_FULL },
  { id: 'cpp-mecanum-tuning', drive: 'mecanum', title: 'Mecanum — tuning example', code: CPP_MECANUM_TUNING },
  {
    id: 'cpp-bug-skid-swapped', drive: 'skid', title: 'Find the bug: wrong way', code: CPP_BUG_SKID_SWAPPED, bug: true,
    task: 'Push the stick right. The robot should turn clockwise (right) but it turns the other way.',
    hint: 'To turn right, which side must go forward and which must go backward? Compare l and r with the basic example.',
    answer: CPP_ANSWERS.swapped,
  },
  {
    id: 'cpp-bug-skid-scaling', drive: 'skid', title: 'Find the bug: no scaling', code: CPP_BUG_SKID_NO_SCALING, bug: true,
    task: 'Push the stick forward-right. The values go far past 255 and get clamped, so the robot does not curve as it should.',
    hint: '(y + x) * 2.55 can be up to 510. What did the full example do with the biggest value first?',
    answer: CPP_ANSWERS.scaling,
  },
  {
    id: 'cpp-bug-skid-deadzone', drive: 'skid', title: 'Find the bug: no deadzone', code: CPP_BUG_SKID_NO_DEADZONE, bug: true,
    task: 'A gamepad stick never rests at exactly 0, so the robot creeps when you let go. Use the "Gentle stick" test script to see it.',
    hint: 'There is a deadzone variable. Is it used anywhere in mix()?',
    answer: CPP_ANSWERS.deadzone,
  },
  {
    id: 'cpp-bug-mecanum-diagonal', drive: 'mecanum', title: 'Find the bug: slides diagonally', code: CPP_BUG_MECANUM_DIAGONAL, bug: true,
    task: 'Push the stick right. A mecanum robot should slide straight right, but this one goes diagonally.',
    hint: 'When you slide right, all four wheels must work. Look at b and c: do they use x at all?',
    answer: CPP_ANSWERS.diagonal,
  },
];

// Omni X (wheels on the corners, axles in an X) uses the SAME mix4(x, y, r) as mecanum: same signs, same tests.
function forOmni(ex) {
  const note = ex.lang === 'cpp'
    ? '// The wheels sit on the corners with their axles in an X. The same mixing works as for mecanum.\n'
    : '# The wheels sit on the corners with their axles in an X. The same mixing works as for mecanum.\n';
  return {
    ...ex,
    id: ex.id.replace('mecanum', 'omni'),
    drive: 'omni',
    title: ex.title.replace('Mecanum', 'Omni X'),
    code: ex.code.replace(/^(.*?)Mecanum( - [^\n]*)\n/, (m, pre, post) => `${pre}Omni X${post}\n${ex.bug ? '' : note}`),
    task: ex.task?.replace(/A mecanum robot/g, 'An Omni X robot').replace(/mecanum/gi, 'Omni X'),
  };
}

const BASE_EXAMPLES = [...withLang(PYTHON_EXAMPLES, 'python'), ...withLang(CPP_EXAMPLES, 'cpp')];
export const EXAMPLES = [...BASE_EXAMPLES, ...BASE_EXAMPLES.filter((e) => e.drive === 'mecanum').map(forOmni)];

export const DEFAULT_EXAMPLE = {
  python: { skid: 'skid-full', mecanum: 'mecanum-full', omni: 'omni-full' },
  cpp: { skid: 'cpp-skid-full', mecanum: 'cpp-mecanum-full', omni: 'cpp-omni-full' },
};

export const exampleById = (id) => EXAMPLES.find((e) => e.id === id);
