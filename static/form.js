(function () {
  'use strict';

  // --- Tab switching ---
  var tabs = document.querySelectorAll('.form-tab');
  var detailsPane = document.querySelector('.tab-content-details');
  var relPane = document.querySelector('.tab-content-relationships');

  if (tabs.length && detailsPane && relPane) {
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        if (tab.dataset.tab === 'details') {
          detailsPane.style.display = 'block';
          relPane.style.display = 'none';
        } else {
          detailsPane.style.display = 'none';
          relPane.style.display = 'block';
        }
      });
    });
  }

  // --- AJAX relationship management ---
  var personId = document.querySelector('.form-card') &&
                 document.querySelector('.form-card').dataset.personId;
  if (!personId) return;

  var relList = document.getElementById('rel-list');
  var relEmpty = document.getElementById('rel-empty');
  var relError = document.getElementById('rel-error');
  var addBtn = document.getElementById('rel-add-btn');
  var typeSelect = document.getElementById('rel-type');
  var otherSelect = document.getElementById('rel-other-id');

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Add relationship
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var relType = typeSelect.value;
      var otherId = otherSelect.value;
      if (relError) relError.textContent = '';

      if (!relType || !otherId) {
        if (relError) relError.textContent = 'Please select both a type and a person.';
        return;
      }

      var body = 'person_id=' + encodeURIComponent(personId) +
                 '&other_id=' + encodeURIComponent(otherId) +
                 '&rel_type=' + encodeURIComponent(relType);

      fetch('/relationship/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body
      })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          if (relError) relError.textContent = result.data.error || 'Failed to add relationship.';
          return;
        }
        var d = result.data;
        // Hide empty message
        if (relEmpty) relEmpty.style.display = 'none';
        // Build new row
        var div = document.createElement('div');
        div.className = 'rel-item rel-item-enter';
        div.dataset.relId = d.rel_id;
        div.innerHTML =
          '<span class="rel-label">' + escapeHtml(d.label) + '</span>' +
          '<span class="rel-person"><a href="/person/' + d.person_id + '">' +
          escapeHtml(d.person_name) + '</a></span>' +
          '<button type="button" class="btn-outline-danger btn-sm rel-remove-btn" ' +
          'data-rel-id="' + d.rel_id + '" data-person-id="' + personId + '">Remove</button>';
        relList.appendChild(div);
        // Reset selects
        typeSelect.value = '';
        otherSelect.value = '';
      })
      .catch(function () {
        if (relError) relError.textContent = 'Network error. Please try again.';
      });
    });
  }

  // Remove relationship (event delegation)
  if (relList) {
    relList.addEventListener('click', function (e) {
      var btn = e.target.closest('.rel-remove-btn');
      if (!btn) return;

      var relId = btn.dataset.relId;
      var relPersonId = btn.dataset.personId;
      var row = btn.closest('.rel-item');

      fetch('/relationship/' + relId + '/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: 'person_id=' + encodeURIComponent(relPersonId)
      })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          row.classList.add('rel-item-exit');
          row.addEventListener('animationend', function () {
            row.remove();
            // Show empty message if no items left
            if (relList.querySelectorAll('.rel-item').length === 0 && relEmpty) {
              relEmpty.style.display = 'block';
            }
          });
        }
      });
    });
  }
})();
