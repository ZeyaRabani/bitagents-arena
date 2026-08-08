// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BitHumans} from "../src/BitHumans.sol";

contract Deploy is Script {
    function run() external returns (BitHumans bithumans) {
        uint256 deployerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        bithumans = new BitHumans(deployer);
        vm.stopBroadcast();

        console.log("BitHumans deployed at:", address(bithumans));
        console.log("Relayer:", deployer);
    }
}
