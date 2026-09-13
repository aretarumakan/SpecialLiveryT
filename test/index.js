/**
 * `node --test test/` の入口。
 *
 * Node 22 の test runner は位置引数をディレクトリとして展開しない（ファイル／glob として扱う）。
 * そのため `node --test test/` は「test ディレクトリ」＝この index.js を 1 つのテストファイルとして
 * 実行する。ここから各テストを import すれば、設計書どおりのコマンドがそのまま通る。
 *
 * 個別に動かしたいときは
 *   node --test test/db.test.js
 *   node --test "test/*.test.js"
 */
import './db.test.js';
import './status.test.js';
import './api.test.js';
import './validate.test.js';
import './auth.test.js';
import './mockflow.test.js';
import './admin.test.js';
import './position.test.js';
import './livery-page.test.js';
