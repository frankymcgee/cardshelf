// Only the outer disclosure controls Table tools; nested Audio credits has its own summary.
export async function openTableTools(page) {
  const menu = page.locator('.arena-table-tools');
  if (!await menu.evaluate(element => element.open)) {
    await menu.locator(':scope > summary').click();
  }
}
