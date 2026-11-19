function applyTheme(theme){theme=['dark','light','red'].includes(theme)?theme:'dark';document.documentElement.dataset.theme=theme;$('themeSelect').value=theme;$('themeButton').textContent=theme==='dark'?'☀ Tema luminoasă':'☾ Tema întunecată';$('themeButton').setAttribute('aria-pressed',String(theme!=='dark'));try{localStorage.setItem('sp500-dashivo-theme',theme)}catch{}}
let savedTheme='dark';try{savedTheme=localStorage.getItem('sp500-dashivo-theme')||'dark'}catch{}applyTheme(savedTheme);
$('themeButton').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('themeSelect').addEventListener('change',e=>applyTheme(e.target.value));
for(const link of document.querySelectorAll('.nav a'))link.addEventListener('click',()=>{for(const other of document.querySelectorAll('.nav a')){other.classList.remove('on');other.removeAttribute('aria-current')}link.classList.add('on');link.setAttribute('aria-current','location')});
