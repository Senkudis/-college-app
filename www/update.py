import os, re

def process():
    files_dir = 'c:/Users/kde/Desktop/kedwebcbs-main/www'
    
    # 1. Update login.css to include .btn-loading
    login_css_path = os.path.join(files_dir, 'css', 'login.css')
    with open(login_css_path, 'r', encoding='utf-8') as f:
        login_css = f.read()
    if '.btn-loading' not in login_css:
        login_css += '''
/* Unified Spinner */
.btn-loading {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s ease-in-out infinite;
}
'''
        with open(login_css_path, 'w', encoding='utf-8') as f:
            f.write(login_css)

    # background HTML
    bg_html = '''
  <!-- Background Orbs -->
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <div class="bg-orb bg-orb-3"></div>
'''

    # Function to inject orbs right after <body>
    def inject_orbs(content):
        if 'bg-orb' not in content:
            content = re.sub(r'(<body[^>]*>)', r'\1' + bg_html, content, count=1)
        return content

    # Helper styles from login.html
    glass_card_css = '''
      background: rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset, 0 1px 0 rgba(255, 255, 255, 0.1) inset;
'''
    orbs_css = '''
    body { background: #051527; }
    .bg-orb { position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.25; animation: orbFloat 8s ease-in-out infinite; z-index: 0; pointer-events: none; }
    .bg-orb-1 { width: 400px; height: 400px; background: #2563eb; top: -100px; right: -80px; animation-delay: 0s; }
    .bg-orb-2 { width: 300px; height: 300px; background: #06b6d4; bottom: -80px; left: -60px; animation-delay: -4s; }
    .bg-orb-3 { width: 200px; height: 200px; background: #7c3aed; top: 50%; left: 50%; transform: translate(-50%, -50%); animation-delay: -2s; }
    @keyframes orbFloat { 0%, 100% { transform: scale(1) translate(0, 0); } 33% { transform: scale(1.1) translate(20px, -20px); } 66% { transform: scale(0.95) translate(-15px, 15px); } }
'''

    def inject_styles(content, card_selector):
        # Remove old body background and insert orbs_css before </style>
        content = re.sub(r'body\s*{[^}]*background:[^;]+;([^}]*)}', r'body {\1}', content)
        # Update the card background
        content = re.sub(card_selector + r'\s*{[^}]*background:[^;]+;([^}]*)}', card_selector + r' { \1' + glass_card_css + '}', content)
        # Add orbs_css before </style>
        content = re.sub(r'(</style>)', orbs_css + r'\1', content)
        
        # Add login.css to head if not present
        if 'login.css' not in content:
            content = re.sub(r'(</head>)', r'  <link rel="stylesheet" href="/css/login.css">\n\1', content)
        return content


    # register.html
    reg_path = os.path.join(files_dir, 'register.html')
    with open(reg_path, 'r', encoding='utf-8') as f:
        reg = f.read()
    
    # 2.2 Fix font-family and update background/card
    reg = re.sub(r'font-family:\s*system-ui[^;]+;', '', reg)
    reg = inject_orbs(reg)
    reg = inject_styles(reg, r'\.reg-card')
    # Make sure reg-card is relative and z-index so it shows over orbs
    reg = re.sub(r'(\.reg-card\s*{)', r'\1 position: relative; z-index: 1;', reg)
    
    # 2.5 Unified spinner
    reg = re.sub(r'<i class="ri-loader-4-line"[^>]*></i>', r'<span class="btn-loading"></span>', reg)

    with open(reg_path, 'w', encoding='utf-8') as f:
        f.write(reg)
        
    # forgot-password.html
    forgot_path = os.path.join(files_dir, 'forgot-password.html')
    with open(forgot_path, 'r', encoding='utf-8') as f:
        forgot = f.read()
        
    forgot = inject_orbs(forgot)
    forgot = inject_styles(forgot, r'\.auth-card')
    forgot = re.sub(r'(\.auth-card\s*{)', r'\1 position: relative; z-index: 1;', forgot)
    
    # 2.5 Unified spinner in forgot password
    forgot = re.sub(r'<span class="spinner"[^>]*></span>', r'<span class="btn-loading"></span>', forgot)
    
    with open(forgot_path, 'w', encoding='utf-8') as f:
        f.write(forgot)

    # force-change-password.html
    force_path = os.path.join(files_dir, 'force-change-password.html')
    with open(force_path, 'r', encoding='utf-8') as f:
        force = f.read()
        
    force = inject_orbs(force)
    force = inject_styles(force, r'\.auth-card')
    force = re.sub(r'(\.auth-card\s*{)', r'\1 position: relative; z-index: 1;', force)
    
    with open(force_path, 'w', encoding='utf-8') as f:
        f.write(force)

process()
print("Done processing")
