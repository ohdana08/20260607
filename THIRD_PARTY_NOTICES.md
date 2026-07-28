# Third-party notices

이 저장소는 아래 오픈소스 프로젝트의 설계·파싱 로직 일부를 참고했습니다.

## djfksjd/ir-search (MIT License)

- 저장소: https://github.com/djfksjd/ir-search
- 참고 범위: `lib/data/nipa.ts`, `lib/data/smtech.ts`의 공개 게시판 파싱 로직(정규식·페이지네이션
  방식)을 ir-search의 `skills/ir-search/scripts/sources_crawl.py`(`page_nipa`, `page_smtech`)를
  참고해 TypeScript로 재작성했습니다. K-Startup·기업마당 크롤러는 참고하지 않았습니다(gov-plan은
  두 소스 모두 공식 데이터포털 API를 사용 중).

```
MIT License

Copyright (c) 2026 ir-search contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
