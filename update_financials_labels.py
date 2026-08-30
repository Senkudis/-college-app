import os
import re

html_path = r"c:\Users\kde\Desktop\kedwebcbs-main\www\financials.html"
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace lines 1506-1516 block
content = content.replace(
'''                <td>
                  <div class="d-flex flex-column">
                    <span class="fw-bold">${esc(studentName)}</span>
                    <small class="text-muted">${esc(studentEmail)}</small>
                  </div>
                </td>
                <td><span class="badge" style="background:var(--bg-hover);color:var(--text-main);font-size:0.75rem; border:1px solid var(--border)">${esc(batchName)}</span></td>
                <td><span class="badge bg-primary-subtle text-primary">${(b.totalFees || 0).toFixed(2)} ج.س</span></td>
                <td><span class="badge bg-success-subtle text-success">${(b.totalPaid || 0).toFixed(2)} ج.س</span></td>
                <td><span class="badge bg-danger-subtle text-danger fw-bold">${Math.max(0, (b.totalFees || 0) - (b.totalPaid || 0)).toFixed(2)} ج.س</span></td>
                <td>''', 
'''                <td data-label="الطالب">
                  <div class="d-flex flex-column">
                    <span class="fw-bold">${esc(studentName)}</span>
                    <small class="text-muted">${esc(studentEmail)}</small>
                  </div>
                </td>
                <td data-label="الدفعة"><span class="badge" style="background:var(--bg-hover);color:var(--text-main);font-size:0.75rem; border:1px solid var(--border)">${esc(batchName)}</span></td>
                <td data-label="إجمالي الرسوم"><span class="badge bg-primary-subtle text-primary">${(b.totalFees || 0).toFixed(2)} ج.س</span></td>
                <td data-label="المدفوع"><span class="badge bg-success-subtle text-success">${(b.totalPaid || 0).toFixed(2)} ج.س</span></td>
                <td data-label="المتبقي"><span class="badge bg-danger-subtle text-danger fw-bold">${Math.max(0, (b.totalFees || 0) - (b.totalPaid || 0)).toFixed(2)} ج.س</span></td>
                <td data-label="إجراءات">'''
)

# Replace lines 1830-1840 block
content = content.replace(
'''              <td class="font-bold">${CBS.escapeHTML(r.student?.name || 'طالب محذوف')}</td>
              <td class="text-success font-bold">${r.amount.toFixed(2)} ج.س</td>
              <td>${CBS.escapeHTML(r.reference || r.notes || '-')}</td>
              <td>${CBS.formatDate(r.createdAt)}</td>
              <td>
                <a href="${fileUrl}" target="_blank" style="display: inline-block; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: transform 0.2s; background: var(--bg-card);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                  <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; color: white; pointer-events: none;"><i class="ri-zoom-in-line" style="font-size: 1.5rem;"></i></div>
                  <img src="${fileUrl}" onerror="this.src='/img/placeholder.jpg'" alt="إشعار" style="width: 60px; height: 60px; object-fit: cover; display: block;" onmouseover="this.previousElementSibling.style.opacity='1'" onmouseout="this.previousElementSibling.style.opacity='0'">
                </a>
              </td>
              <td>''',
'''              <td data-label="الطالب" class="font-bold">${CBS.escapeHTML(r.student?.name || 'طالب محذوف')}</td>
              <td data-label="المبلغ" class="text-success font-bold">${r.amount.toFixed(2)} ج.س</td>
              <td data-label="رقم الإيصال">${CBS.escapeHTML(r.reference || r.notes || '-')}</td>
              <td data-label="التاريخ">${CBS.formatDate(r.createdAt)}</td>
              <td data-label="صورة الإشعار">
                <a href="${fileUrl}" target="_blank" style="display: inline-block; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: transform 0.2s; background: var(--bg-card);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                  <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; color: white; pointer-events: none;"><i class="ri-zoom-in-line" style="font-size: 1.5rem;"></i></div>
                  <img src="${fileUrl}" onerror="this.src='/img/placeholder.jpg'" alt="إشعار" style="width: 60px; height: 60px; object-fit: cover; display: block;" onmouseover="this.previousElementSibling.style.opacity='1'" onmouseout="this.previousElementSibling.style.opacity='0'">
                </a>
              </td>
              <td data-label="الإجراء">'''
)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated financials.html")
