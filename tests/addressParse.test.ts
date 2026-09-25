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
