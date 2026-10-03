import { describe, expect, it } from "vitest";
import { parseAddress } from "@/lib/addressParse";

describe("智能识别地址", () => {
  it("多行（亚马逊 / Shopify 订单复制）", () => {
    expect(parseAddress("John Doe\n500 Congress Ave Apt 4\nAustin, TX 78701-1234\nUnited States\nPhone: +1 512-555-0100")).toEqual({
      nameFirst: "John", nameLast: "Doe", address1: "500 Congress Ave", address2: "Apt 4",
      city: "Austin", province: "TX", zipCode: "78701-1234", country: "US", phone: "+1 512-555-0100",
    });
  });

  it("一行逗号分隔，州写全称，带邮箱", () => {
    expect(parseAddress("Mary Ann Smith, 123 Main St, Suite 200, Los Angeles, California 90001, (213) 555-0199, mary@example.com")).toMatchObject({
      nameFirst: "Mary Ann", nameLast: "Smith", address1: "123 Main St", address2: "Suite 200",
      city: "Los Angeles", province: "CA", zipCode: "90001", phone: "(213) 555-0199", email: "mary@example.com",
    });
  });

  it("带中文标签", () => {
    expect(parseAddress("收件人：Jane Roe\n电话：3465550143\n地址：2 Test Ave, Salem, OR 97301")).toMatchObject({
      nameFirst: "Jane", nameLast: "Roe", phone: "3465550143", address1: "2 Test Ave", city: "Salem", province: "OR", zipCode: "97301",
    });
  });

  it("公司名 + 州邮编单独一行", () => {
    expect(parseAddress("Alex Lee\nAcme Inc\n77 Harbor Blvd\nMiami\nFL 33101\nUSA")).toMatchObject({
      nameFirst: "Alex", nameLast: "Lee", corporateName: "Acme Inc", address1: "77 Harbor Blvd",
      city: "Miami", province: "FL", zipCode: "33101", country: "US",
    });
  });

  it("名字后面跟电话、没有逗号的城市行", () => {
    expect(parseAddress("Sam Lee 612-555-0101\n4 Test Ln\nMinneapolis MN 55401")).toMatchObject({
      nameFirst: "Sam", nameLast: "Lee", phone: "612-555-0101", address1: "4 Test Ln", city: "Minneapolis", province: "MN", zipCode: "55401",
    });
  });

  it("空内容", () => {
    expect(parseAddress("   ")).toEqual({});
  });
});

describe("体验官反馈的写法", () => {
  it("姓名、电话、街道连在一行（有逗号 / 没逗号）", async () => {
    const { parseAddress } = await import("@/lib/addressParse");
    expect(parseAddress("Jane Roe 5125550100 500 Congress Ave, Austin, TX 78701")).toMatchObject({
      nameFirst: "Jane", nameLast: "Roe", phone: "5125550100", address1: "500 Congress Ave", city: "Austin", province: "TX", zipCode: "78701",
    });
    expect(parseAddress("Jane Roe 512-555-0100 500 Congress Ave Austin TX 78701")).toMatchObject({
      nameFirst: "Jane", nameLast: "Roe", phone: "512-555-0100", address1: "500 Congress Ave", city: "Austin", province: "TX", zipCode: "78701",
    });
  });
  it("英国、加拿大地址：识别国家、邮编、国际电话", async () => {
    const { parseAddress } = await import("@/lib/addressParse");
    expect(parseAddress("Emma Brown\n221B Baker Street\nLondon NW1 6XE\nUnited Kingdom\n+44 20 7946 0958")).toMatchObject({
      nameFirst: "Emma", nameLast: "Brown", address1: "221B Baker Street", city: "London", zipCode: "NW1 6XE", country: "GB", phone: "+44 20 7946 0958",
    });
    expect(parseAddress("Liam Smith\n100 King St W\nToronto ON M5H 2N2\nCanada")).toMatchObject({
      nameFirst: "Liam", nameLast: "Smith", address1: "100 King St W", city: "Toronto", province: "ON", zipCode: "M5H 2N2", country: "CA",
    });
    expect(parseAddress("Max Muster\nHauptstrasse 5\n10115 Berlin\nGermany")).toMatchObject({ city: "Berlin", zipCode: "10115", country: "DE" });
  });

  it("邮编后 4 位没写全（91789-281）：只取前 5 位，城市州照常识别", () => {
    expect(parseAddress("test\n19515 E WALNUT DR N\nWALNUT CA   91789-281")).toMatchObject({
      address1: "19515 E WALNUT DR N", city: "WALNUT", province: "CA", zipCode: "91789", country: "US",
    });
    expect(parseAddress("test\n19515 E WALNUT DR N\nWALNUT CA   91789-281").address2).toBeUndefined();
  });

  it("一行里带中文标签：收件人 / 电话 / 地址分开识别", () => {
    expect(parseAddress("收件人: Mike Chen 电话: 6265550123 地址: 123 Main St Unit 4, Los Angeles, CA 90012")).toMatchObject({
      nameFirst: "Mike", nameLast: "Chen", phone: "6265550123", address1: "123 Main St", address2: "Unit 4", city: "Los Angeles", province: "CA", zipCode: "90012",
    });
  });

  it("没有逗号的单行地址，行尾带 USA", () => {
    expect(parseAddress("Bob Smith 742 Evergreen Terrace Springfield IL 62704 USA")).toMatchObject({
      nameFirst: "Bob", nameLast: "Smith", address1: "742 Evergreen Terrace", city: "Springfield", province: "IL", zipCode: "62704", country: "US",
    });
  });
});
