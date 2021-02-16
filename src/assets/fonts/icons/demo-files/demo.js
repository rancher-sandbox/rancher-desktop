if (!('boxShadow' in document.body.style)) {
  document.body.setAttribute('class', 'noBoxShadow');
}

document.body.addEventListener('click', (e) => {
  const target = e.target;

  if (target.tagName === 'INPUT' &&
        !target.getAttribute('class').includes('liga')) {
    target.select();
  }
});

(function() {
  const fontSize = document.getElementById('fontSize');
  const testDrive = document.getElementById('testDrive');
  const testText = document.getElementById('testText');

  function updateTest() {
    testDrive.innerHTML = testText.value || String.fromCharCode(160);
    if (window.icomoonLiga) {
      window.icomoonLiga(testDrive);
    }
  }

  function updateSize() {
    testDrive.style.fontSize = `${ fontSize.value }px`;
  }
  fontSize.addEventListener('change', updateSize, false);
  testText.addEventListener('input', updateTest, false);
  testText.addEventListener('change', updateTest, false);
  updateSize();
}());
