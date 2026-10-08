import { describe, expect, it } from "vitest";
import { parseAddress } from "@/lib/addressParse";

describe("智能识别地址：公寓号写在街道前面、国家带括号代码", () => {
  it("公寓号单独一行写在街道前面：归到地址2，不当成公司名", () => {
    expect(parseAddress("John Doe\nApt 4B\n200 Elm St\nBoston, MA 02110")).toEqual({
      nameFirst: "John", nameLast: "Doe", address1: "200 Elm St", address2: "Apt 4B", city: "Boston", province: "MA", zipCode: "02110", country: "US",
    });
    // 三位数的套房号以前会整行丢掉
    expect(parseAddress("Jane Roe\nSuite 300\n1 Market St\nSan Francisco CA 94105")).toMatchObject({
      nameFirst: "Jane", nameLast: "Roe", address1: "1 Market St", address2: "Suite 300", city: "San Francisco", province: "CA", zipCode: "94105",
    });
    // 公司名照样认出来，公寓号不混进公司名
    const r = parseAddress("Alex Lee\nAcme Inc\nUnit 12\n77 Harbor Blvd\nMiami, FL 33101");
    expect(r).toMatchObject({ nameFirst: "Alex", nameLast: "Lee", corporateName: "Acme Inc", address1: "77 Harbor Blvd", address2: "Unit 12", city: "Miami" });
    // 一行逗号分隔也一样
    expect(parseAddress("Sam Lee, #5, 4 Test Ln, Minneapolis, MN 55401")).toMatchObject({ nameFirst: "Sam", nameLast: "Lee", address1: "4 Test Ln", address2: "#5", city: "Minneapolis" });
  });

  it("“United States (US)” 认成美国，不留在地址2", () => {
    const want = { nameFirst: "John", nameLast: "Doe", address1: "200 Elm St", city: "Boston", province: "MA", zipCode: "02110", country: "US" };
    const a = parseAddress("John Doe\n200 Elm St\nBoston, MA 02110\nUnited States (US)");
    expect(a).toEqual(want);
    expect(a.address2).toBeUndefined();
    expect(parseAddress("John Doe\n200 Elm St\nBoston MA 02110 United States (US)")).toEqual(want);
    expect(parseAddress("John Doe, 200 Elm St, Boston, MA 02110, United States (US)")).toEqual(want);
    expect(parseAddress("John Doe\n200 Elm St\nBoston, MA 02110\nUSA（US）").address2).toBeUndefined();
    // 其他国家带括号代码
    expect(parseAddress("Liam Smith\n100 King St W\nToronto ON M5H 2N2\nCanada (CA)")).toMatchObject({ country: "CA", city: "Toronto", zipCode: "M5H 2N2" });
    // 普通的括号内容不受影响
    expect(parseAddress("Ann Lee\nAcme (HQ)\n5 Oak Rd\nAustin, TX 78701")).toMatchObject({ corporateName: "Acme (HQ)", address1: "5 Oak Rd" });
  });

  it("原来能认的写法照旧", () => {
    expect(parseAddress("John Doe\n500 Congress Ave Apt 4\nAustin, TX 78701-1234\nUnited States\nPhone: +1 512-555-0100")).toEqual({
      nameFirst: "John", nameLast: "Doe", address1: "500 Congress Ave", address2: "Apt 4",
      city: "Austin", province: "TX", zipCode: "78701-1234", country: "US", phone: "+1 512-555-0100",
    });
    expect(parseAddress("Alex Lee\nAcme Inc\n77 Harbor Blvd\nMiami\nFL 33101\nUSA")).toMatchObject({ corporateName: "Acme Inc", address1: "77 Harbor Blvd", city: "Miami" });
    expect(parseAddress("Yixi Mei\n13725 los angeles st., APT J\nBALDWIN PARK, CA 91706 US")).toMatchObject({ address2: "APT J", country: "US" });
  });
});
