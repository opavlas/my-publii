(function () {
  var T = {
    cs: {
      'nav.home':              'Domů',
      'nav.products':          'Produkty',
      'nav.function':          'Funkce',
      'nav.contact':           'Kontakt',
      'footer.contact':        'Kontakt',

      'hero.eyebrow':          'Ručně vyráběné hodiny',
      'hero.btn':              'Zobrazit produkty',
      'hero.scroll':           'Posunout',

      'products.heading':      'Hodiny',
      'products.subheading':   'Ručně vyráběné — každý kus originál',
      'products.view':         'Zobrazit produkt →',

      'function.heading':      'Funkce',
      'function.subheading':   'Jak hodiny zobrazují čas',
      'function.desc':         'Hodiny pahoclock zobrazují čas slovy v pětiminutových intervalech. Vyzkoušejte si níže, jak hodiny vypadají v různých časech.',

      'product.back':          '← Všechny produkty',
      'product.specs':         'Specifikace',
      'spec.material':         'Materiál',
      'spec.dimensions':       'Rozměry',
      'spec.weight':           'Hmotnost',
      'spec.finish':           'Povrch',
      'spec.power':            'Spotřeba',
      'spec.dimensions.value': '47,5 × 47,5 cm',
      'spec.power.value':      '5 W',
      'product.order':         'Objednat',

      'dark.desc':     'Ručně vyráběné nástěnné slovní hodiny, které jedinečným způsobem zobrazují čas slovy v češtině nebo angličtině. Každý kus je originál, pečlivě vytvořený s důrazem na detail. Hodiny nejen přesně měří čas, ale zároveň se stávají výrazným designovým prvkem interiéru. Ideální pro ty, kteří hledají spojení funkčnosti, originality a moderního stylu.',
      'dark.material': 'Sklo',
      'dark.weight':   '5 kg',
      'dark.finish':   'Černé lesklé sklo',

      'corten.desc':     'Ručně vyráběné nástěnné slovní hodiny, které jedinečným způsobem zobrazují čas slovy v češtině nebo angličtině. Každý kus je originál, pečlivě vytvořený s důrazem na detail. Hodiny nejen přesně měří čas, ale zároveň se stávají výrazným designovým prvkem interiéru. Ideální pro ty, kteří hledají spojení funkčnosti, originality a moderního stylu.',
      'corten.material': 'Cortenová ocel',
      'corten.weight':   '3 kg',
      'corten.finish':   'Rezavý kov',

      'contact.title':        'Kontakt',
      'contact.subtitle':     'Kontaktujte nás',
      'contact.heading':      'Prosím kontaktujte nás.',
      'contact.text':         'Každou objednávku řešíme individuálně s každým zákazníkem.',
      'contact.email.label':  'E-mail',
      'contact.phone.label':  'Telefon',
    },
    en: {
      'nav.home':              'Home',
      'nav.products':          'Products',
      'nav.function':          'Function',
      'nav.contact':           'Contact',
      'footer.contact':        'Contact',

      'hero.eyebrow':          'Handcrafted timepieces',
      'hero.btn':              'See Products',
      'hero.scroll':           'Scroll',

      'products.heading':      'Clocks',
      'products.subheading':   'Handcrafted — every piece an original',
      'products.view':         'View product →',

      'function.heading':      'Function',
      'function.subheading':   'How the clock tells time',
      'function.desc':         'The pahoclock displays time in words at five-minute intervals. Try the interactive demo below to see how the clock looks at different times.',

      'product.back':          '← All Products',
      'product.specs':         'Specifications',
      'spec.material':         'Material',
      'spec.dimensions':       'Dimensions',
      'spec.weight':           'Weight',
      'spec.finish':           'Finish',
      'spec.power':            'Power',
      'spec.dimensions.value': '47.5 × 47.5 cm',
      'spec.power.value':      '5 W',
      'product.order':         'Order Now',

      'dark.desc':     'Handcrafted wall word clocks that uniquely display time in words in Czech or English. Each piece is an original, carefully crafted with attention to detail. The clocks not only accurately measure time but also become a distinctive design element of any interior. Ideal for those seeking a combination of functionality, originality, and modern style.',
      'dark.material': 'Glass',
      'dark.weight':   '5 kg',
      'dark.finish':   'Black Shiny Glass',

      'corten.desc':     'Handcrafted wall word clocks that uniquely display time in words in Czech or English. Each piece is an original, carefully crafted with attention to detail. The clocks not only accurately measure time but also become a distinctive design element of any interior. Ideal for those seeking a combination of functionality, originality, and modern style.',
      'corten.material': 'Corten Steel',
      'corten.weight':   '3 kg',
      'corten.finish':   'Rusty Metal',

      'contact.title':        'Contact',
      'contact.subtitle':     'Get in touch — we\'d love to hear from you',
      'contact.heading':      'Please contact us.',
      'contact.text':         'We handle every order individually with each customer.',
      'contact.email.label':  'Email',
      'contact.phone.label':  'Phone',
    }
  };

  var PAGE_TITLES = {
    cs: {
      index:    'pahoclock',
      products: 'Produkty — pahoclock',
      function: 'Funkce — pahoclock',
      dark:     'pahoclock — Dark',
      corten:   'pahoclock — Corten',
      contact:  'Kontakt — pahoclock',
    },
    en: {
      index:    'pahoclock',
      products: 'Products — pahoclock',
      function: 'Function — pahoclock',
      dark:     'pahoclock — Dark',
      corten:   'pahoclock — Corten',
      contact:  'Contact — pahoclock',
    }
  };

  var lang = localStorage.getItem('pahoclock-lang') || 'cs';

  function applyLang(l) {
    lang = l;
    var t = T[l];
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      if (key && t[key] !== undefined) el.textContent = t[key];
    });
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = l === 'cs' ? 'EN' : 'CZ';
    document.documentElement.lang = l;
    var page = document.body.dataset.page;
    if (page && PAGE_TITLES[l] && PAGE_TITLES[l][page]) {
      document.title = PAGE_TITLES[l][page];
    }
    localStorage.setItem('pahoclock-lang', l);
  }

  window.toggleLang = function () {
    applyLang(lang === 'cs' ? 'en' : 'cs');
  };

  document.addEventListener('DOMContentLoaded', function () {
    applyLang(lang);
  });
})();
