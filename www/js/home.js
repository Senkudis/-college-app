/* ===== مكوّنات الصفحات الرئيسية (dashboard.html و admin_dashboard.html) =====
   عقد التصميم وأسبابه في docs/design/home-screens.md. كل صفحة رئيسية تجيب
   "ما الذي يحتاجني الآن؟": تحية، الآن/التالي، يحتاج انتباهك، ثلاثة مؤشرات
   قابلة للضغط، وصول سريع بأيقونات، ثم التنبيهات. الأنماط: .hm-* في style.css */
(function () {
  const esc = v => CBS.escapeHTML(v == null ? '' : String(v));
  const CHEV = '<i class="ri-arrow-left-s-line" aria-hidden="true"></i>';
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  const Home = {
    esc, CHEV,

    /* التحية: "صباح الخير، سارة" + التاريخ، والدور في الترويسة */
    greet(user, role) {
      const roleLabel = { dean: 'العميد', admin: 'المسؤول', doctor: 'عضو هيئة التدريس', leader: 'قائد الدفعة', student: 'طالب' }[role] || 'طالب';
      const parts = (user.name || '').trim().split(/\s+/).filter(Boolean);
      // "د. سلمى الطيب" تبقى "د. سلمى"، وغيرها الاسم الأول فقط
      const name = parts.length > 1 && /^(د|م|أ)\.?$/.test(parts[0]) ? parts.slice(0, 2).join(' ') : (parts[0] || '');
      document.getElementById('hmTitle').textContent = `${new Date().getHours() < 12 ? 'صباح الخير' : 'مساء الخير'}${name ? '، ' + name : ''}`;
      document.getElementById('hmDate').textContent = new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
      const sub = document.getElementById('headerSubtitle');
      if (sub) sub.textContent = roleLabel;
    },

    row({ href = '#', icon, tone, title, meta, chip, chipTone }) {
      return `<a class="hm-row" href="${href}">
        <span class="hm-ic"${tone ? ` data-tone="${tone}"` : ''}><i class="${icon}"></i></span>
        <div class="hm-row-body"><div class="hm-row-title">${esc(title)}</div>${meta ? `<div class="hm-row-meta">${esc(meta)}</div>` : ''}</div>
        <span class="hm-row-end">${chip ? `<span class="hm-chip"${chipTone ? ` data-tone="${chipTone}"` : ''}>${esc(chip)}</span>` : ''}${CHEV}</span>
      </a>`;
    },

    empty(title, meta, icon = 'ri-checkbox-circle-line', tone = '') {
      return `<div class="hm-row hm-empty">
        <span class="hm-ic"${tone ? ` data-tone="${tone}"` : ''}><i class="${icon}"></i></span>
        <div class="hm-row-body"><div class="hm-row-title">${esc(title)}</div>${meta ? `<div class="hm-row-meta">${esc(meta)}</div>` : ''}</div>
      </div>`;
    },

    /* ثلاثة مؤشرات فقط، وكل رقم رابط لصفحة تفاصيله */
    kpis(items) {
      document.getElementById('hmKpis').innerHTML = items.map(k =>
        `<a class="hm-kpi" href="${k.href}"><span class="hm-kpi-val"${k.tone ? ` data-tone="${k.tone}"` : ''}>${esc(k.val)}</span><span class="hm-kpi-label">${esc(k.label)}</span></a>`
      ).join('');
    },

    /* نسبة الحضور: أحمر تحت 75٪ (حد الحرمان)، كهرماني تحت 85٪ */
    attendanceTone(pct) { return pct == null ? '' : pct < 75 ? 'danger' : pct < 85 ? 'warning' : 'success'; },

    /* موعد مقروء: اليوم / غداً / بعد 3 أيام — والإلحاح باللون فقط */
    due(when) {
      const d = new Date(when);
      if (isNaN(d)) return { text: '', tone: '' };
      if (startOfDay(d) < startOfDay(new Date())) return { text: 'متأخر', tone: 'danger' };
      const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
      if (days <= 0) return { text: 'اليوم', tone: 'danger' };
      if (days === 1) return { text: 'غداً', tone: 'warning' };
      if (days === 2) return { text: 'بعد يومين', tone: 'warning' };
      if (days <= 10) return { text: `بعد ${days} أيام`, tone: '' };
      return { text: d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }), tone: '' };
    },

    ago(when) {
      const d = new Date(when), mins = Math.round((Date.now() - d) / 60000);
      if (isNaN(d)) return '';
      if (mins < 1) return 'الآن';
      if (mins < 60) return `منذ ${mins} د`;
      if (mins < 24 * 60) return `منذ ${Math.round(mins / 60)} س`;
      if (startOfDay(d).getTime() === startOfDay(Date.now() - 864e5).getTime()) return 'أمس';
      return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
    },

    /* يعيد data من { success, data } أو الجسم كما هو، وnull عند أي فشل —
       القسم الذي يفشل يعرض حالة هادئة ولا يكسر بقية الصفحة */
    async get(url) {
      try {
        const res = await CBS.apiGet(url);
        if (!res || !res.ok) return null;
        const j = await res.json();
        return j && typeof j === 'object' && 'data' in j ? j.data : j;
      } catch { return null; }
    },

    updates(list, hostId = 'activitiesContainer') {
      const host = document.getElementById(hostId);
      if (!host) return;
      if (!Array.isArray(list) || !list.length) {
        host.innerHTML = Home.empty('لا تنبيهات جديدة', 'ستظهر هنا إعلانات الكلية والدكاترة', 'ri-notification-off-line', 'info');
        return;
      }
      host.innerHTML = list.slice(0, 3).map(n => Home.row({
        href: '/notifications.html',
        icon: n.type === 'emergency' ? 'ri-alarm-warning-line' : 'ri-notification-3-line',
        tone: n.type === 'emergency' ? 'danger' : 'info',
        title: n.title, meta: n.message, chip: Home.ago(n.createdAt)
      })).join('');
    },

    /* ===== الوصول السريع واللوحة السفلية "كل الأدوات" =====
       التسميات قصيرة بلا وصف، وما في الشريط السفلي لا يتكرر في الوصول السريع. */
    tools: (() => {
      const T = (href, icon, label, tone = '') => ({ href, icon, label, tone });
      return {
        subjects:    T('/subjects.html', 'ri-book-2-line', 'المواد'),
        assignments: T('/assignments.html', 'ri-task-line', 'الواجبات'),
        quizzes:     T('/quizzes.html', 'ri-question-answer-line', 'الاختبارات'),
        videos:      T('/video-library.html', 'ri-play-circle-line', 'المحاضرات المسجلة'),
        lab:         T('/code-lab.html', 'ri-terminal-box-line', 'مختبر البرمجة'),
        attendance:  T('/attendance-history.html', 'ri-calendar-check-line', 'سجل حضوري'),
        calendar:    T('/calendar.html', 'ri-calendar-event-line', 'التقويم'),
        pastExams:   T('/past-exams.html', 'ri-archive-line', 'بنك الامتحانات'),
        flashcards:  T('/flashcards.html', 'ri-stack-line', 'بطاقات الاستذكار'),
        pods:        T('/study-pods.html', 'ri-team-line', 'غرف المذاكرة'),
        myReport:    T('/my-report.html', 'ri-bar-chart-2-line', 'تقريري'),
        portfolio:   T('/student-portfolio.html', 'ri-file-chart-line', 'ملخص النشاط'),
        leaderboard: T('/leaderboard.html', 'ri-trophy-line', 'المتصدرون'),
        surveys:     T('/course-surveys.html', 'ri-survey-line', 'تقييم المقررات'),
        gallery:     { ...T('#', 'ri-gallery-line', 'معرض الصور'), onclick: 'openStudentGalleryModal()' },
        fees:        T('/financials.html', 'ri-money-dollar-circle-line', 'الرسوم'),
        notifs:      T('/notifications.html', 'ri-notification-3-line', 'التنبيهات'),
        mLectures:   T('/manage-lectures.html', 'ri-video-upload-line', 'رفع محاضرة'),
        mAttendance: T('/manage-attendance.html', 'ri-user-follow-line', 'رصد الحضور'),
        mSubs:       T('/manage-submissions.html', 'ri-inbox-archive-line', 'التسليمات'),
        mAssign:     T('/assignments.html', 'ri-file-list-3-line', 'إدارة الواجبات'),
        mNotifs:     T('/manage-notifications.html', 'ri-megaphone-line', 'إرسال إشعار'),
        studio:      T('/creator-studio.html', 'ri-magic-line', 'استوديو المحتوى'),
        campus:      T('/campus.html', 'ri-compass-3-line', 'مركز اليوم'),
        admin:       T('/admin_dashboard.html', 'ri-shield-star-line', 'لوحة الكلية', 'solid'),
        reports:     T('/reports.html', 'ri-line-chart-line', 'التقارير'),
        users:       T('/manage-users.html', 'ri-group-line', 'المستخدمون'),
        batches:     T('/manage-batches.html', 'ri-layout-grid-line', 'الدفعات'),
        mSubjects:   T('/manage-subjects.html', 'ri-book-open-line', 'المقررات'),
        pending:     T('/pending-registrations.html', 'ri-user-add-line', 'طلبات التسجيل'),
        content:     T('/admin-content.html', 'ri-newspaper-line', 'الأخبار والمعرض'),
        moderation:  T('/moderation.html', 'ri-flag-line', 'البلاغات'),
        version:     { ...T('#', 'ri-rocket-line', 'إصدار التطبيق'), onclick: 'openAppVersionModal()' }
      };
    })(),

    badges: {},        // { '/manage-submissions.html': 5 } — عدد على أيقونة الأداة
    batchQuery: '',
    _quick: [], _groups: [],

    _tile(tool) {
      const plain = tool.href === '#' || tool.href.startsWith('/admin_dashboard') || tool.href.startsWith('/manage-batches');
      const href = plain ? tool.href : tool.href + Home.batchQuery;
      const badge = Home.badges[tool.href];
      const inner = `<span class="hm-qa-ic"${tool.tone ? ` data-tone="${tool.tone}"` : ''}><i class="${tool.icon}"></i>${badge ? `<span class="hm-qa-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span><span>${esc(tool.label)}</span>`;
      return tool.onclick
        ? `<button type="button" class="hm-qa" onclick="CBSHome.closeSheet();${tool.onclick}">${inner}</button>`
        : `<a class="hm-qa" href="${href}">${inner}</a>`;
    },

    actions(quick, groups) {
      if (quick) Home._quick = quick;
      if (groups) Home._groups = groups;
      document.getElementById('hmActions').innerHTML = Home._quick.map(Home._tile).join('') +
        `<button type="button" class="hm-qa" onclick="CBSHome.openSheet()" aria-haspopup="dialog"><span class="hm-qa-ic"><i class="ri-apps-2-line"></i></span><span>المزيد</span></button>`;
      document.getElementById('hmSheetBody').innerHTML = Home._groups.map(([title, tools]) =>
        `<div class="hm-sheet-group"><h3>${esc(title)}</h3><div class="hm-actions">${tools.map(Home._tile).join('')}</div></div>`
      ).join('');
    },

    _returnFocus: null,
    openSheet() {
      Home._returnFocus = document.activeElement;
      document.getElementById('hmSheet').classList.add('show');
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.querySelector('#hmSheet .hm-sheet-close')?.focus({ preventScroll: true }), 50);
    },
    // زر الرجوع في أندرويد يغلقها أيضاً عبر _closeTopOverlay (.overlay.show)
    closeSheet() {
      const sheet = document.getElementById('hmSheet');
      if (!sheet || !sheet.classList.contains('show')) return;
      sheet.classList.remove('show');
      document.body.style.overflow = '';
      Home._returnFocus?.focus?.({ preventScroll: true });
    }
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') Home.closeSheet(); });
  window.CBSHome = Home;
})();
