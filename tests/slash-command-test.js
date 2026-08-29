/**
 * 斜杠命令系统测试脚本
 * 测试命令选择后是否能正确发送给后端
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🚀 启动测试...');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // 监听控制台输出
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn' || msg.type() === 'error') {
      console.log(`[Browser ${msg.type()}]: ${msg.text()}`);
    }
  });

  try {
    // 1. 打开编辑器
    console.log('1️⃣ 打开编辑器...');
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(3000);

    // 2. 检查是否有连接错误
    const errorText = await page.locator('.error-status').textContent().catch(() => null);
    if (errorText) {
      console.log('⚠️ 检测到错误:', errorText);
    }

    // 3. 找到 Agent 输入框
    console.log('2️⃣ 查找 Agent 输入框...');
    const textarea = page.locator('.composer__input');
    const exists = await textarea.count();
    console.log(`   输入框数量: ${exists}`);

    if (exists > 0) {
      // 4. 输入斜杠触发命令菜单
      console.log('3️⃣ 输入 "/" 触发命令菜单...');
      await textarea.click();
      await textarea.fill('/');
      await page.waitForTimeout(500);

      // 5. 检查菜单是否显示
      const menu = page.locator('.slash-menu');
      const menuVisible = await menu.isVisible().catch(() => false);
      console.log(`   菜单是否显示: ${menuVisible}`);

      if (menuVisible) {
        // 6. 获取菜单项
        const items = page.locator('.slash-menu__item');
        const itemCount = await items.count();
        console.log(`   菜单项数量: ${itemCount}`);

        // 7. 显示所有菜单项
        for (let i = 0; i < Math.min(itemCount, 5); i++) {
          const text = await items.nth(i).textContent();
          console.log(`   - ${text?.trim()}`);
        }

        // 8. 选择第一个命令
        if (itemCount > 0) {
          console.log('4️⃣ 选择第一个命令...');
          await items.first().click();
          await page.waitForTimeout(300);

          // 9. 检查输入框内容
          const value = await textarea.inputValue();
          console.log(`   输入框内容: "${value}"`);

          // 10. 按 Enter 发送
          console.log('5️⃣ 按 Enter 发送命令...');
          await textarea.press('Enter');
          await page.waitForTimeout(1000);

          // 11. 检查是否有响应
          console.log('6️⃣ 检查响应...');
          const messages = page.locator('.message-bubble');
          const messageCount = await messages.count();
          console.log(`   消息数量: ${messageCount}`);
        }
      } else {
        console.log('❌ 菜单未显示，尝试输入更多内容...');

        // 尝试输入 "pl" 触发 plan
        await textarea.fill('/pl');
        await page.waitForTimeout(500);

        const menuVisible2 = await menu.isVisible().catch(() => false);
        console.log(`   输入 "/pl" 后菜单显示: ${menuVisible2}`);
      }
    }

    // 12. 截图保存
    console.log('7️⃣ 保存截图...');
    await page.screenshot({ path: 'E:\\DemoStudio\\tests\\slash-command-test.png' });

    console.log('✅ 测试完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await browser.close();
  }
})();
